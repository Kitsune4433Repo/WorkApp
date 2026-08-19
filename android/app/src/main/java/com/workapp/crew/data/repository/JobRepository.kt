package com.workapp.crew.data.repository

import android.content.Context
import com.workapp.crew.data.local.dao.JobDao
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.CreateJobRequest
import com.workapp.crew.data.remote.LatLngDto
import com.workapp.crew.sync.SyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Job Board: reads the local Room cache SyncWorker already keeps current via sync/pull/jobs (same
 * source of truth the offline map/geofence features use), and lets admin/crew_lead start, stop, or
 * create a job — full parity with web's DispatcherDashboard, minus the geofence-polygon-drawing tool
 * (no map-drawing widget on Android yet; a created job falls back to the server's default radius,
 * same as when the web form's polygon step is skipped). */
@Singleton
class JobRepository @Inject constructor(
    private val dao: JobDao,
    private val api: ApiService,
    @ApplicationContext private val context: Context,
) {
    fun observeJobs() = dao.observeAll()

    fun refresh() = SyncWorker.triggerImmediateSync(context)

    suspend fun create(jobNumber: String, title: String, description: String?, priority: String, lat: Double, lng: Double) {
        api.createJob(CreateJobRequest(jobNumber, title, description, priority, LatLngDto(lat, lng)))
        refresh()
    }

    suspend fun startJob(jobId: String) {
        api.startJob(jobId)
        refresh()
    }

    suspend fun stopJob(jobId: String) {
        api.stopJob(jobId)
        refresh()
    }
}
