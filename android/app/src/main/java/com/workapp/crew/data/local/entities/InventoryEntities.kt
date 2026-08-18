package com.workapp.crew.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "material_catalog")
data class MaterialEntity(
    @PrimaryKey val id: String,
    val sku: String,
    val name: String,
    val category: String,
    val unit: String,
)

@Entity(tableName = "truck_inventory", primaryKeys = ["materialId"])
data class TruckInventoryEntity(
    val materialId: String,
    val quantityHave: Double,
    val version: Long,
    val updatedAt: Long,
)

/**
 * Every +/- tap or QR transfer is written here immediately (optimistic UI) and mirrored to
 * [com.workapp.crew.data.local.entities.OutboxEntity] for sync. Local balance is always the sum
 * of applied deltas, so the plus/minus controls never wait on network round-trips.
 */
@Entity(tableName = "inventory_pending_deltas")
data class InventoryPendingDeltaEntity(
    @PrimaryKey val clientTxnId: String,
    val materialId: String,
    val delta: Double,
    val jobId: String?,
    val occurredAt: Long,
    val synced: Boolean = false,
)
