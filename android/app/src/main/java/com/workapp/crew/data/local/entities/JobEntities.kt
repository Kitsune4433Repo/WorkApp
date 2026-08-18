package com.workapp.crew.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "jobs")
data class JobEntity(
    @PrimaryKey val id: String,
    val jobNumber: String,
    val title: String,
    val description: String?,
    val status: String,
    val priority: String,
    val siteLat: Double,
    val siteLng: Double,
    val geofenceRadiusM: Int?,
    val geofencePolygonJson: String?, // serialized list of {lat,lng}; polygon check runs on-device too for instant UX
    val scheduledStart: Long?,
    val scheduledEnd: Long?,
    val updatedAt: Long,
)

@Entity(tableName = "job_required_materials", primaryKeys = ["jobId", "materialId"])
data class JobRequiredMaterialEntity(
    val jobId: String,
    val materialId: String,
    val quantityNeeded: Double,
    val quantityStaged: Double,
)
