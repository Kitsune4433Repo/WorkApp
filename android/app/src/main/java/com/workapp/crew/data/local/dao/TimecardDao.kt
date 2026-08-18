package com.workapp.crew.data.local.dao

import androidx.room.*
import com.workapp.crew.data.local.entities.LocationPingEntity
import com.workapp.crew.data.local.entities.TimecardEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface TimecardDao {
    @Query("SELECT * FROM timecards WHERE clockOutAt IS NULL ORDER BY clockInAt DESC LIMIT 1")
    fun observeActive(): Flow<TimecardEntity?>

    @Upsert
    suspend fun upsert(timecard: TimecardEntity)

    @Query("SELECT * FROM timecards WHERE synced = 0")
    suspend fun getUnsynced(): List<TimecardEntity>

    @Query("UPDATE timecards SET synced = 1, serverId = :serverId WHERE clientEventId = :clientEventId")
    suspend fun markSynced(clientEventId: String, serverId: String)

    @Insert
    suspend fun insertLocationPing(ping: LocationPingEntity)

    @Query("SELECT * FROM location_pings_outbox WHERE synced = 0 ORDER BY recordedAt LIMIT 500")
    suspend fun getUnsyncedPings(): List<LocationPingEntity>

    @Query("UPDATE location_pings_outbox SET synced = 1 WHERE localId IN (:ids)")
    suspend fun markPingsSynced(ids: List<Long>)

    @Query("DELETE FROM location_pings_outbox WHERE synced = 1 AND recordedAt < :beforeMillis")
    suspend fun pruneOldSyncedPings(beforeMillis: Long)
}
