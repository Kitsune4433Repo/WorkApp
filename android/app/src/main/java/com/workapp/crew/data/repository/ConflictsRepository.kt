package com.workapp.crew.data.repository

import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.ResolveConflictRequest
import com.workapp.crew.data.remote.SyncConflictDto
import javax.inject.Inject
import javax.inject.Singleton

/** Admin/crew_lead review queue for offline edits that couldn't merge automatically — matches
 * web/src/pages/ConflictReviewPage.tsx. */
@Singleton
class ConflictsRepository @Inject constructor(private val api: ApiService) {
    suspend fun list(): List<SyncConflictDto> = api.getConflicts()

    suspend fun resolve(id: String, resolution: String) {
        api.resolveConflict(id, ResolveConflictRequest(resolution))
    }
}
