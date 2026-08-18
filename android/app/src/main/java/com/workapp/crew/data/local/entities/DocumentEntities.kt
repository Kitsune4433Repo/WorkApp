package com.workapp.crew.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "documents")
data class DocumentEntity(
    @PrimaryKey val id: String,
    val title: String,
    val docType: String,
    val isMap: Boolean,
    val currentVersion: Int,
    val localFilePath: String?, // populated once the file body is cached for offline viewing
    val updatedAt: Long,
)

/**
 * Freehand redline/highlight strokes drawn on a cached map (feature 7). Kept fully local and
 * offline-editable; [synced] flips once the layer is pushed and no server conflict was flagged.
 */
@Entity(tableName = "map_annotations")
data class MapAnnotationEntity(
    @PrimaryKey(autoGenerate = true) val localId: Long = 0,
    val documentId: String,
    val documentVersion: Int,
    val layerDataJson: String, // serialized List<StrokePath>
    val localVersion: Int,
    val clientId: String,
    val synced: Boolean = false,
)

@Entity(tableName = "photo_proofs_outbox")
data class PhotoProofEntity(
    @PrimaryKey val clientPhotoId: String,
    val jobId: String,
    val localFilePath: String,
    val takenAt: Long,
    val lat: Double?,
    val lng: Double?,
    val synced: Boolean = false,
)
