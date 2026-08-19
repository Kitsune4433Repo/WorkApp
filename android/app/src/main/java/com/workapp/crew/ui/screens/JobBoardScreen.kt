package com.workapp.crew.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.local.entities.JobEntity
import com.workapp.crew.data.repository.AuthRepository
import com.workapp.crew.data.repository.JobRepository
import com.workapp.crew.ui.util.PeriodicRefresh
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

private val JOB_MANAGE_ROLES = setOf("admin", "crew_lead")

@HiltViewModel
class JobBoardViewModel @Inject constructor(
    private val repository: JobRepository,
    authRepository: AuthRepository,
) : ViewModel() {
    val canManageJobs = authRepository.currentRole in JOB_MANAGE_ROLES

    val jobs = repository.observeJobs().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private var busyJobId by mutableStateOf<String?>(null)
    val currentBusyJobId get() = busyJobId

    fun refresh() = repository.refresh()

    fun startJob(jobId: String) = viewModelScope.launch {
        busyJobId = jobId
        try { repository.startJob(jobId) } finally { busyJobId = null }
    }

    fun stopJob(jobId: String) = viewModelScope.launch {
        busyJobId = jobId
        try { repository.stopJob(jobId) } finally { busyJobId = null }
    }
}

/** Job Board — mirrors web/src/pages/DispatcherDashboard.tsx's job list (creation/geofence drawing
 * stays on the web portal, which has the space for that form and a map). Reads the same local job
 * cache the offline map/geofence features already rely on. */
@Composable
fun JobBoardScreen(viewModel: JobBoardViewModel = hiltViewModel()) {
    val jobs by viewModel.jobs.collectAsState()
    PeriodicRefresh { viewModel.refresh() }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Job Board", style = MaterialTheme.typography.headlineSmall)
            IconButton(onClick = { viewModel.refresh() }) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh") }
        }
        Spacer(Modifier.height(12.dp))
        if (jobs.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("No jobs yet.", style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.Center)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(jobs, key = { it.id }) { job ->
                    JobCard(
                        job = job,
                        canManage = viewModel.canManageJobs,
                        busy = viewModel.currentBusyJobId == job.id,
                        onStart = { viewModel.startJob(job.id) },
                        onStop = { viewModel.stopJob(job.id) },
                    )
                }
            }
        }
    }
}

private fun formatScheduled(epochMillis: Long?): String? {
    if (epochMillis == null) return null
    return SimpleDateFormat("MMM d, h:mm a", Locale.US).format(Date(epochMillis))
}

@Composable
private fun JobCard(job: JobEntity, canManage: Boolean, busy: Boolean, onStart: () -> Unit, onStop: () -> Unit) {
    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(job.jobNumber, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(job.title, style = MaterialTheme.typography.titleMedium)
                }
                StatusPill(job.status)
            }
            formatScheduled(job.scheduledStart)?.let {
                Spacer(Modifier.height(4.dp))
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (canManage) {
                Spacer(Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (job.status == "in_progress") {
                        OutlinedButton(onClick = onStop, enabled = !busy) { Text(if (busy) "…" else "Stop") }
                    } else {
                        Button(onClick = onStart, enabled = !busy) { Text(if (busy) "…" else "Start") }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusPill(status: String) {
    val (bg, fg) = when (status) {
        "in_progress" -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        "completed", "closed" -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
        else -> MaterialTheme.colorScheme.secondaryContainer to MaterialTheme.colorScheme.onSecondaryContainer
    }
    Surface(color = bg, shape = MaterialTheme.shapes.extraSmall) {
        Text(
            status.replace('_', ' ').replaceFirstChar { it.uppercase() },
            color = fg,
            style = MaterialTheme.typography.labelSmall,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}
