package com.workapp.crew.data.local.dao

import androidx.room.*
import com.workapp.crew.data.local.entities.JobEntity
import com.workapp.crew.data.local.entities.JobRequiredMaterialEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface JobDao {
    @Query("SELECT * FROM jobs ORDER BY scheduledStart ASC")
    fun observeAll(): Flow<List<JobEntity>>

    @Query("SELECT * FROM jobs WHERE id = :jobId")
    suspend fun getById(jobId: String): JobEntity?

    @Upsert
    suspend fun upsertAll(jobs: List<JobEntity>)

    @Query("SELECT * FROM job_required_materials WHERE jobId = :jobId")
    fun observeRequiredMaterials(jobId: String): Flow<List<JobRequiredMaterialEntity>>

    @Upsert
    suspend fun upsertRequiredMaterials(items: List<JobRequiredMaterialEntity>)
}
