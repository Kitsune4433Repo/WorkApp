package com.workapp.crew.data.repository

import android.content.Context
import com.workapp.crew.data.local.dao.TimecardDao
import com.workapp.crew.data.local.entities.TimecardEntity
import com.workapp.crew.data.remote.AuthTokenStore
import com.workapp.crew.services.LocationTrackingService
import com.workapp.crew.sync.SyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

data class LiveEarnings(val activeMinutes: Long, val earningsCents: Long, val onBreak: Boolean)

@Singleton
class TimecardRepository @Inject constructor(
    private val dao: TimecardDao,
    private val tokenStore: AuthTokenStore,
    @ApplicationContext private val context: Context,
) {
    fun observeActive(): Flow<TimecardEntity?> = dao.observeActive()

    /**
     * Feature 4 (money-to-hours): live earnings recomputed from the open timecard every time the
     * UI recomposes, using the technician's hourly-rate snapshot captured at clock-in so a
     * mid-shift rate change never rewrites hours already worked.
     */
    fun observeLiveEarnings(): Flow<LiveEarnings?> = dao.observeActive().map { tc ->
        tc ?: return@map null
        val onBreak = tc.breakStartAt != null && tc.breakEndAt == null
        val elapsedMinutes = (System.currentTimeMillis() - tc.clockInAt) / 60_000
        val activeMinutes = (elapsedMinutes - tc.totalBreakMinutes).coerceAtLeast(0)
        val earningsCents = (activeMinutes * tc.hourlyRateCents) / 60
        LiveEarnings(activeMinutes, earningsCents, onBreak)
    }

    suspend fun clockIn(jobId: String?, lat: Double, lng: Double, hourlyRateCents: Int) {
        dao.upsert(
            TimecardEntity(
                clientEventId = UUID.randomUUID().toString(),
                serverId = null,
                jobId = jobId,
                clockInAt = System.currentTimeMillis(),
                clockInLat = lat,
                clockInLng = lng,
                hourlyRateCents = hourlyRateCents,
            ),
        )
        LocationTrackingService.start(context, jobId)
        SyncWorker.triggerImmediateSync(context)
    }

    suspend fun clockOut(current: TimecardEntity, lat: Double, lng: Double) {
        dao.upsert(current.copy(clockOutAt = System.currentTimeMillis(), clockOutLat = lat, clockOutLng = lng, synced = false))
        LocationTrackingService.stop(context)
        SyncWorker.triggerImmediateSync(context)
    }
}
