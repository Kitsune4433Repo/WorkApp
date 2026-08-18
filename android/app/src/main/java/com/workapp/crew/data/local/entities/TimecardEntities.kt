package com.workapp.crew.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "timecards")
data class TimecardEntity(
    @PrimaryKey val clientEventId: String,
    val serverId: String?,
    val jobId: String?,
    val clockInAt: Long,
    val clockInLat: Double,
    val clockInLng: Double,
    val breakStartAt: Long? = null,
    val breakEndAt: Long? = null,
    val clockOutAt: Long? = null,
    val clockOutLat: Double? = null,
    val clockOutLng: Double? = null,
    val hourlyRateCents: Int,
    val totalBreakMinutes: Int = 0,
    val synced: Boolean = false,
)

@Entity(tableName = "location_pings_outbox")
data class LocationPingEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val jobId: String?,
    val lat: Double,
    val lng: Double,
    val accuracyM: Float?,
    val recordedAt: Long,
    val batteryPct: Int?,
    val synced: Boolean = false,
)
