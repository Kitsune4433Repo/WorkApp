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
import com.workapp.crew.ui.util.rememberCurrentLocation
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Inject

private val JOB_MANAGE_ROLES = setOf("admin", "crew_lead")
private val PRIORITIES = listOf("low", "medium", "high", "urgent")

@HiltViewModel
class JobBoardViewModel @Inject constructor(
    private val repository: JobRepository,
    authRepository: AuthRepository,
) : ViewModel() {
    val canManageJobs = authRepository.currentRole in JOB_MANAGE_ROLES

    val jobs = repository.observeJobs().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    private var busyJobId by mutableStateOf<String?>(null)
    val currentBusyJobId get() = busyJobId

    var creatingJob by mutableStateOf(false)
        private set
    var createJobError by mutableStateOf<String?>(null)
        private set

    fun refresh() = repository.refresh()

    fun startJob(jobId: String) = viewModelScope.launch {
        busyJobId = jobId
        try { repository.startJob(jobId) } finally { busyJobId = null }
    }

    fun stopJob(jobId: String) = viewModelScope.launch {
        busyJobId = jobId
        try { repository.stopJob(jobId) } finally { busyJobId = null }
    }

    fun createJob(jobNumber: String, title: String, description: String?, priority: String, lat: Double, lng: Double, onDone: () -> Unit) {
        creatingJob = true
        createJobError = null
        viewModelScope.launch {
            try {
                repository.create(jobNumber, title, description, priority, lat, lng)
                onDone()
            } catch (e: retrofit2.HttpException) {
                createJobError = if (e.code() == 403) "Only admin/crew_lead can create jobs." else "Failed to create job (${e.code()})."
            } catch (e: java.io.IOException) {
                createJobError = "Can't reach the server. Check your connection."
            } finally {
                creatingJob = false
            }
        }
    }
}

/** Job Board — mirrors web/src/pages/DispatcherDashboard.tsx's job list plus creation (minus the
 * geofence-polygon-drawing tool, which needs a map-drawing widget Android doesn't have yet — a job
 * created here falls back to the server's default radius). Reads the same local job cache the
 * offline map/geofence features already rely on. */
@Composable
fun JobBoardScreen(viewModel: JobBoardViewModel = hiltViewModel()) {
    val jobs by viewModel.jobs.collectAsState()
    PeriodicRefresh { viewModel.refresh() }
    var showCreate by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Job Board", style = MaterialTheme.typography.headlineSmall)
            Row {
                if (viewModel.canManageJobs) {
                    TextButton(onClick = { showCreate = !showCreate }) { Text(if (showCreate) "Cancel" else "+ New job") }
                }
                IconButton(onClick = { viewModel.refresh() }) { Icon(Icons.Filled.Refresh, contentDescription = "Refresh") }
            }
        }

        if (showCreate) {
            Spacer(Modifier.height(8.dp))
            CreateJobForm(
                saving = viewModel.creatingJob,
                error = viewModel.createJobError,
                onCreate = { jobNumber, title, description, priority, lat, lng ->
                    viewModel.createJob(jobNumber, title, description, priority, lat, lng) { showCreate = false }
                },
            )
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CreateJobForm(
    saving: Boolean,
    error: String?,
    onCreate: (jobNumber: String, title: String, description: String?, priority: String, lat: Double, lng: Double) -> Unit,
) {
    val location = rememberCurrentLocation()
    var jobNumber by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var priority by remember { mutableStateOf("medium") }
    var priorityMenuExpanded by remember { mutableStateOf(false) }

    ElevatedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("New job", style = MaterialTheme.typography.titleSmall)
            OutlinedTextField(value = jobNumber, onValueChange = { jobNumber = it }, label = { Text("Job #") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = title, onValueChange = { title = it }, label = { Text("Title") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(value = description, onValueChange = { description = it }, label = { Text("Description (optional)") }, modifier = Modifier.fillMaxWidth())

            ExposedDropdownMenuBox(expanded = priorityMenuExpanded, onExpandedChange = { priorityMenuExpanded = it }) {
                OutlinedTextField(
                    value = priority.replaceFirstChar { it.uppercase() },
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Priority") },
                    modifier = Modifier.menuAnchor().fillMaxWidth(),
                )
                ExposedDropdownMenu(expanded = priorityMenuExpanded, onDismissRequest = { priorityMenuExpanded = false }) {
                    PRIORITIES.forEach { p ->
                        DropdownMenuItem(text = { Text(p.replaceFirstChar { c -> c.uppercase() }) }, onClick = { priority = p; priorityMenuExpanded = false })
                    }
                }
            }

            Text(
                if (location != null) "Site location: current GPS position" else "Getting your location…",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }

            Button(
                onClick = { location?.let { (lat, lng) -> onCreate(jobNumber.trim(), title.trim(), description.trim().ifBlank { null }, priority, lat, lng) } },
                enabled = !saving && location != null && jobNumber.isNotBlank() && title.isNotBlank(),
                modifier = Modifier.align(Alignment.End),
            ) { Text(if (saving) "Creating…" else "Create job") }
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
