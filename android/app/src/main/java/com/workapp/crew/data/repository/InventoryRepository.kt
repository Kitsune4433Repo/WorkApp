package com.workapp.crew.data.repository

import com.workapp.crew.data.local.dao.InventoryDao
import com.workapp.crew.data.local.entities.InventoryPendingDeltaEntity
import com.workapp.crew.data.local.entities.TruckInventoryEntity
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.QrTransferClaimResponse
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

    /** Pulls the server-authoritative have ledger (see SyncWorker.pullHaveLedger) so changes made
     * elsewhere — the website, another phone — show up here without a manual restart. */
    fun refresh() = SyncWorker.triggerImmediateSync(context)

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

    /** Feature 12, receiving side: claims a scanned transfer token and reflects the credited
     * quantity in the local ledger immediately. The claimed material only shows up in the have
     * ledger UI once it's in the local material catalog — normally already true by the time a
     * transfer happens, since SyncWorker.pullMaterials() keeps that cache current in the background. */
    suspend fun claimQrTransfer(token: String): QrTransferClaimResponse {
        val response = api.claimQrTransfer(token)
        val currentBalance = dao.getQuantityHave(response.materialId) ?: 0.0
        dao.upsertBalance(
            TruckInventoryEntity(
                materialId = response.materialId,
                quantityHave = currentBalance + response.quantity,
                version = 0,
                updatedAt = System.currentTimeMillis(),
            ),
        )
        SyncWorker.triggerImmediateSync(context)
        return response
    }
}
