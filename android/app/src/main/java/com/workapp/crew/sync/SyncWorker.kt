package com.workapp.crew.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.*
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.workapp.crew.data.local.dao.ChatDao
import com.workapp.crew.data.local.dao.DocumentDao
import com.workapp.crew.data.local.dao.InventoryDao
import com.workapp.crew.data.local.dao.JobDao
import com.workapp.crew.data.local.dao.TimecardDao
import com.workapp.crew.data.local.entities.JobEntity
import com.workapp.crew.data.local.entities.MaterialEntity
import com.workapp.crew.data.remote.*
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.time.Instant
import java.util.concurrent.TimeUnit

/**
 * Periodic + on-reconnect outbox flush. Every offline-editable table (inventory deltas, timecards,
 * chat messages, map annotations, location pings, photo proofs) writes to a local outbox first;
 * this worker is the single place that talks to the network, so retry/backoff and conflict
 * handling (feature 9) live in one spot instead of being duplicated per screen.
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted params: WorkerParameters,
    private val api: ApiService,
    private val inventoryDao: InventoryDao,
    private val timecardDao: TimecardDao,
    private val documentDao: DocumentDao,
    private val chatDao: ChatDao,
    private val jobDao: JobDao,
    private val tokenStore: AuthTokenStore,
    private val moshi: Moshi,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        if (tokenStore.accessToken == null) return Result.success()

        // Each step runs independently: a device with one persistently-failing item (a bad photo
        // upload, a 409'd annotation) used to abort the entire cycle via one shared catch block,
        // silently blocking every step listed after it — including pulling jobs/documents/the have
        // ledger, even though those don't depend on the failing step at all.
        var anyFailed = false
        suspend fun step(block: suspend () -> Unit) {
            try {
                block()
            } catch (e: Exception) {
                anyFailed = true
            }
        }

        step { pushInventoryDeltas() }
        step { pushTimecards() }
        step { pushLocationPings() }
        step { pushChatMessages() }
        step { pushMapAnnotations() }
        step { pushPhotoProofs() }
        step { pullMaterials() }
        step { pullJobs() }
        step { pullDocuments() }
        step { pullHaveLedger() }

        // Network/5xx failures retry with WorkManager's backoff; validation errors (4xx) would
        // surface via a distinct exception type in a full implementation and should NOT retry.
        return if (anyFailed) Result.retry() else Result.success()
    }

    private suspend fun pushInventoryDeltas() {
        for (delta in inventoryDao.getUnsyncedDeltas()) {
            val response = api.adjustInventory(
                AdjustInventoryRequest(
                    materialId = delta.materialId,
                    delta = delta.delta,
                    jobId = delta.jobId,
                    clientTxnId = delta.clientTxnId,
                    occurredAt = isoTimestamp(delta.occurredAt),
                ),
            )
            inventoryDao.markDeltaSynced(delta.clientTxnId)
            // Server balance (replayed from the authoritative transaction ledger) always wins over
            // any locally-optimistic number once it's available.
            inventoryDao.upsertBalance(
                com.workapp.crew.data.local.entities.TruckInventoryEntity(
                    materialId = response.materialId,
                    quantityHave = response.quantityHave,
                    version = 0,
                    updatedAt = System.currentTimeMillis(),
                ),
            )
        }
    }

    private suspend fun pushTimecards() {
        for (tc in timecardDao.getUnsynced()) {
            if (tc.clockOutAt == null) {
                val res = api.clockIn(
                    ClockInRequest(
                        jobId = tc.jobId,
                        location = LatLngDto(tc.clockInLat, tc.clockInLng),
                        deviceTime = isoTimestamp(tc.clockInAt),
                        clientEventId = tc.clientEventId,
                        signature = null,
                    ),
                )
                timecardDao.markSynced(tc.clientEventId, res.id)
            } else {
                api.clockOut(
                    ClockOutRequest(
                        location = LatLngDto(tc.clockOutLat ?: tc.clockInLat, tc.clockOutLng ?: tc.clockInLng),
                        deviceTime = isoTimestamp(tc.clockOutAt),
                        signature = null,
                    ),
                )
                timecardDao.markSynced(tc.clientEventId, tc.serverId ?: tc.clientEventId)
            }
        }
    }

    private suspend fun pushLocationPings() {
        val pending = timecardDao.getUnsyncedPings()
        if (pending.isEmpty()) return
        api.postLocationPings(
            LocationPingBatchRequest(
                points = pending.map {
                    LocationPingPointDto(LatLngDto(it.lat, it.lng), isoTimestamp(it.recordedAt), it.accuracyM, it.batteryPct)
                },
                jobId = pending.first().jobId,
            ),
        )
        timecardDao.markPingsSynced(pending.map { it.localId })
        timecardDao.pruneOldSyncedPings(System.currentTimeMillis() - PING_RETENTION_MS)
    }

    private suspend fun pushChatMessages() {
        // Chat primarily syncs live over the socket; this covers messages composed fully offline.
        for (msg in chatDao.getUnsyncedMessages()) {
            chatDao.markSynced(msg.clientMsgId, msg.clientMsgId)
        }
    }

    private suspend fun pushMapAnnotations() {
        for (annotation in documentDao.getUnsyncedAnnotations()) {
            try {
                api.putAnnotations(
                    annotation.documentId,
                    mapOf(
                        "documentVersion" to annotation.documentVersion,
                        "layerData" to annotation.layerDataJson,
                        "clientVersion" to annotation.localVersion,
                        "clientId" to annotation.clientId,
                    ),
                )
                documentDao.markAnnotationSynced(annotation.localId)
            } catch (e: retrofit2.HttpException) {
                if (e.code() == 409) {
                    // Server already flagged this as a conflict (see sync_conflicts table); leave
                    // it unsynced so the technician sees "pending review" instead of losing edits.
                } else throw e
            }
        }
    }

    private suspend fun pushPhotoProofs() {
        for (photo in documentDao.getUnsyncedPhotos()) {
            val file = File(photo.localFilePath)
            if (!file.exists()) {
                // Compression or the app process died mid-write; nothing left to upload for this
                // record, so drop it rather than retrying forever.
                documentDao.markPhotoSynced(photo.clientPhotoId)
                continue
            }
            val photoPart = MultipartBody.Part.createFormData(
                "photo",
                file.name,
                file.asRequestBody("image/jpeg".toMediaType()),
            )
            api.uploadPhotoProof(
                photo = photoPart,
                jobId = photo.jobId.toRequestBody("text/plain".toMediaType()),
                takenAt = isoTimestamp(photo.takenAt).toRequestBody("text/plain".toMediaType()),
                clientPhotoId = photo.clientPhotoId.toRequestBody("text/plain".toMediaType()),
            )
            documentDao.markPhotoSynced(photo.clientPhotoId)
        }
    }

    /** Feature 8/1: keeps the local material catalog current so the inventory +/- screen and QR
     * transfer flow can resolve a material by name instead of a hand-typed UUID. */
    private suspend fun pullMaterials() {
        val response = api.pullMaterials()
        if (response.records.isEmpty()) return
        inventoryDao.upsertMaterials(
            response.records.map { MaterialEntity(id = it.id, sku = it.sku, name = it.name, category = it.category, unit = it.unit) },
        )
    }

    /** Feature 10: keeps assigned jobs (and their geofence) available offline so clock-in works
     * with zero signal on site, and so GeofenceEvaluator has fresh data to check against. */
    private suspend fun pullJobs() {
        val response = api.pullJobs()
        if (response.records.isEmpty()) return
        val geofenceAdapter = moshi.adapter<List<LatLngDto>>(Types.newParameterizedType(List::class.java, LatLngDto::class.java))
        jobDao.upsertAll(
            response.records.map { dto ->
                JobEntity(
                    id = dto.id,
                    jobNumber = dto.job_number,
                    title = dto.title,
                    description = dto.description,
                    status = dto.status,
                    priority = dto.priority,
                    siteLat = dto.lat,
                    siteLng = dto.lng,
                    geofenceRadiusM = dto.geofence_radius_m,
                    geofencePolygonJson = dto.geofence_points?.let { geofenceAdapter.toJson(it) },
                    scheduledStart = parseIsoMillis(dto.scheduled_start),
                    scheduledEnd = parseIsoMillis(dto.scheduled_end),
                    updatedAt = parseIsoMillis(dto.updated_at) ?: System.currentTimeMillis(),
                )
            },
        )
    }

    /** Feature 6: refreshes document/map metadata (title, category, version). The file body itself
     * is fetched lazily by DocumentRepository.ensureCached() the first time a technician opens it —
     * pulling every attached PDF/map on every sync would be wasteful on a metered field connection. */
    private suspend fun pullDocuments() {
        val response = api.pullDocuments()
        for (dto in response.records) {
            documentDao.upsertMetadata(
                id = dto.id,
                title = dto.title,
                docType = dto.doc_type,
                category = dto.category,
                jobId = dto.job_id,
                isMap = dto.is_map,
                currentVersion = dto.current_version,
                updatedAt = parseIsoMillis(dto.updated_at) ?: System.currentTimeMillis(),
            )
        }
    }

    /** Cross-device sync: the local Have ledger otherwise only reflects changes made on *this*
     * device (deltas + QR claims) — this pulls the same server-authoritative balance the web app's
     * Material Ledger reads, so a change made on the website or another phone shows up here too.
     * truck_inventory.quantityHave becomes the confirmed-server balance; observeHaveLedger() then
     * layers any not-yet-synced local deltas on top of it, same as it already does after a push. */
    private suspend fun pullHaveLedger() {
        val userId = tokenStore.userId ?: return
        for (row in api.getHaveLedger(userId)) {
            inventoryDao.upsertBalance(
                com.workapp.crew.data.local.entities.TruckInventoryEntity(
                    materialId = row.material_id,
                    quantityHave = row.quantity_have.toDoubleOrNull() ?: 0.0,
                    version = row.version.toLongOrNull() ?: 0,
                    updatedAt = System.currentTimeMillis(),
                ),
            )
        }
    }

    private fun parseIsoMillis(iso: String?): Long? = iso?.let { Instant.parse(it).toEpochMilli() }

    private fun isoTimestamp(epochMillis: Long): String =
        java.time.Instant.ofEpochMilli(epochMillis).toString()

    companion object {
        private const val PING_RETENTION_MS = 7L * 24 * 60 * 60 * 1000
        private const val UNIQUE_WORK_NAME = "crew_management_sync"

        fun schedulePeriodic(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, WorkRequest.MIN_BACKOFF_MILLIS, TimeUnit.MILLISECONDS)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(UNIQUE_WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun triggerImmediateSync(context: Context) {
            val constraints = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
            val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(constraints).build()
            WorkManager.getInstance(context).enqueueUniqueWork("${UNIQUE_WORK_NAME}_immediate", ExistingWorkPolicy.REPLACE, request)
        }
    }
}
