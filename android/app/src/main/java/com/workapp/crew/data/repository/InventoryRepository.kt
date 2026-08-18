package com.workapp.crew.data.repository

import com.workapp.crew.data.local.dao.InventoryDao
import com.workapp.crew.data.local.entities.InventoryPendingDeltaEntity
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.QrTransferCreateRequest
import com.workapp.crew.sync.SyncWorker
import kotlinx.coroutines.flow.Flow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext

@Singleton
class InventoryRepository @Inject constructor(
    private val dao: InventoryDao,
    private val api: ApiService,
    @ApplicationContext private val context: Context,
) {
    fun observeHaveLedger() = dao.observeHaveLedger()

    /**
     * Feature 1: plus/minus adjustment. Writes to the local ledger instantly for a responsive UI,
     * then lets SyncWorker replay it against the server's append-only transaction log — so two
     * technicians adjusting the same material offline both land correctly once reconnected
     * (see ConflictResolutionService.resolveAdditiveConflict on the backend).
     */
    suspend fun adjust(materialId: String, delta: Double, jobId: String?) {
        dao.insertPendingDelta(
            InventoryPendingDeltaEntity(
                clientTxnId = UUID.randomUUID().toString(),
                materialId = materialId,
                delta = delta,
                jobId = jobId,
                occurredAt = System.currentTimeMillis(),
            ),
        )
        SyncWorker.triggerImmediateSync(context)
    }

    /** Feature 12: generates a short-lived signed QR token another device scans to claim materials. */
    suspend fun createQrTransfer(materialId: String, quantity: Double): String {
        val response = api.createQrTransfer(QrTransferCreateRequest(materialId, quantity, ttlSeconds = 120))
        return response.qrToken
    }

    suspend fun claimQrTransfer(token: String) {
        api.claimQrTransfer(token)
        SyncWorker.triggerImmediateSync(context)
    }
}
