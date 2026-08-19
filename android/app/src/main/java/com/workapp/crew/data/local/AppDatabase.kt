package com.workapp.crew.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import com.workapp.crew.data.local.dao.ChatDao
import com.workapp.crew.data.local.dao.DocumentDao
import com.workapp.crew.data.local.dao.InventoryDao
import com.workapp.crew.data.local.dao.JobDao
import com.workapp.crew.data.local.dao.TimecardDao
import com.workapp.crew.data.local.entities.*

@Database(
    entities = [
        JobEntity::class,
        JobRequiredMaterialEntity::class,
        MaterialEntity::class,
        TruckInventoryEntity::class,
        InventoryPendingDeltaEntity::class,
        TimecardEntity::class,
        LocationPingEntity::class,
        DocumentEntity::class,
        MapAnnotationEntity::class,
        PhotoProofEntity::class,
        ChatChannelEntity::class,
        ChatMessageEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun jobDao(): JobDao
    abstract fun inventoryDao(): InventoryDao
    abstract fun timecardDao(): TimecardDao
    abstract fun documentDao(): DocumentDao
    abstract fun chatDao(): ChatDao

    companion object {
        const val DATABASE_NAME = "crew_management.db"
    }
}
