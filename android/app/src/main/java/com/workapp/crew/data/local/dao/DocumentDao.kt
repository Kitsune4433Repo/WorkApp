package com.workapp.crew.data.local.dao

import androidx.room.*
import com.workapp.crew.data.local.entities.DocumentEntity
import com.workapp.crew.data.local.entities.MapAnnotationEntity
import com.workapp.crew.data.local.entities.PhotoProofEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface DocumentDao {
    @Query("SELECT * FROM documents ORDER BY updatedAt DESC")
    fun observeAll(): Flow<List<DocumentEntity>>

    @Query("SELECT * FROM documents WHERE isMap = 1")
    fun observeMaps(): Flow<List<DocumentEntity>>

    @Upsert
    suspend fun upsertAll(docs: List<DocumentEntity>)

    // Metadata-only upsert used by pull-sync: on conflict, localFilePath is deliberately left out
    // of the SET clause so a previously downloaded/cached file survives a metadata refresh. A plain
    // @Upsert would replace the whole row and silently forget the cached file exists.
    @Query(
        """
        INSERT INTO documents (id, title, docType, category, jobId, isMap, currentVersion, localFilePath, updatedAt)
        VALUES (:id, :title, :docType, :category, :jobId, :isMap, :currentVersion, NULL, :updatedAt)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            docType = excluded.docType,
            category = excluded.category,
            jobId = excluded.jobId,
            isMap = excluded.isMap,
            currentVersion = excluded.currentVersion,
            updatedAt = excluded.updatedAt
        """
    )
    suspend fun upsertMetadata(
        id: String,
        title: String,
        docType: String,
        category: String?,
        jobId: String?,
        isMap: Boolean,
        currentVersion: Int,
        updatedAt: Long,
    )

    @Query("UPDATE documents SET localFilePath = :path WHERE id = :documentId")
    suspend fun setLocalFilePath(documentId: String, path: String)

    @Query("SELECT * FROM map_annotations WHERE documentId = :documentId ORDER BY localId DESC LIMIT 1")
    fun observeLatestAnnotation(documentId: String): Flow<MapAnnotationEntity?>

    @Insert
    suspend fun insertAnnotation(annotation: MapAnnotationEntity)

    @Query("SELECT * FROM map_annotations WHERE synced = 0")
    suspend fun getUnsyncedAnnotations(): List<MapAnnotationEntity>

    @Query("UPDATE map_annotations SET synced = 1 WHERE localId = :localId")
    suspend fun markAnnotationSynced(localId: Long)

    @Insert
    suspend fun insertPhotoProof(photo: PhotoProofEntity)

    @Query("SELECT * FROM photo_proofs_outbox WHERE synced = 0")
    suspend fun getUnsyncedPhotos(): List<PhotoProofEntity>

    @Query("UPDATE photo_proofs_outbox SET synced = 1 WHERE clientPhotoId = :id")
    suspend fun markPhotoSynced(id: String)

    @Query("SELECT * FROM photo_proofs_outbox WHERE jobId = :jobId")
    fun observePhotosForJob(jobId: String): Flow<List<PhotoProofEntity>>
}
