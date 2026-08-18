package com.workapp.crew.data.local.dao

import androidx.room.*
import com.workapp.crew.data.local.entities.InventoryPendingDeltaEntity
import com.workapp.crew.data.local.entities.MaterialEntity
import com.workapp.crew.data.local.entities.TruckInventoryEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface InventoryDao {
    @Query(
        """
        SELECT m.id AS materialId, m.sku, m.name, m.unit,
               COALESCE(ti.quantityHave, 0) +
               COALESCE((SELECT SUM(delta) FROM inventory_pending_deltas d WHERE d.materialId = m.id AND d.synced = 0), 0)
               AS quantityHave
        FROM material_catalog m
        LEFT JOIN truck_inventory ti ON ti.materialId = m.id
        ORDER BY m.name
        """
    )
    fun observeHaveLedger(): Flow<List<HaveLedgerRow>>

    @Upsert
    suspend fun upsertMaterials(materials: List<MaterialEntity>)

    @Upsert
    suspend fun upsertBalance(balance: TruckInventoryEntity)

    @Insert
    suspend fun insertPendingDelta(delta: InventoryPendingDeltaEntity)

    @Query("SELECT * FROM inventory_pending_deltas WHERE synced = 0 ORDER BY occurredAt")
    suspend fun getUnsyncedDeltas(): List<InventoryPendingDeltaEntity>

    @Query("UPDATE inventory_pending_deltas SET synced = 1 WHERE clientTxnId = :clientTxnId")
    suspend fun markDeltaSynced(clientTxnId: String)
}

data class HaveLedgerRow(
    val materialId: String,
    val sku: String,
    val name: String,
    val unit: String,
    val quantityHave: Double,
)
