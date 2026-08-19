package com.workapp.crew.data.repository

import android.content.Context
import com.workapp.crew.data.local.dao.JobDao
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.sync.SyncWorker
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/** Job Board: reads the local Room cache SyncWorker already keeps current via sync/pull/jobs (same
 * source of truth the offline map/geofence features use), and lets admin/crew_lead start or stop a
 * job — the two write actions the backend exposes to mobile (dispatch/creation stays on the web
 * portal, where the geofence-drawing form lives). */
@Singleton
class JobRepository @Inject constructor(
    private val dao: JobDao,
    private val api: ApiService,
    @ApplicationContext private val context: Context,
) {
    fun observeJobs() = dao.observeAll()

    fun refresh() = SyncWorker.triggerImmediateSync(context)

    suspend fun startJob(jobId: String) {
        api.startJob(jobId)
        refresh()
    }

    suspend fun stopJob(jobId: String) {
        api.stopJob(jobId)
        refresh()
    }
}
