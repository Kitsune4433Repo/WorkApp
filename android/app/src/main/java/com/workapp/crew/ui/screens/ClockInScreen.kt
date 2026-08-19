package com.workapp.crew.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.workapp.crew.data.local.dao.JobDao
import com.workapp.crew.data.local.entities.JobEntity
import com.workapp.crew.data.repository.AuthRepository
import com.workapp.crew.data.repository.LiveEarnings
import com.workapp.crew.data.repository.TimecardRepository
import com.workapp.crew.ui.util.rememberCurrentLocation
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

// Clocking in against a completed/cancelled/closed job doesn't make sense — only offer the ones
// still actionable in the field.
private val CLOCKABLE_JOB_STATUSES = setOf("scheduled", "dispatched", "in_progress", "blocked")

@HiltViewModel
class ClockInViewModel @Inject constructor(
    private val repository: TimecardRepository,
    private val authRepository: AuthRepository,
    jobDao: JobDao,
) : ViewModel() {
    val activeTimecard = repository.observeActive().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)
    val liveEarnings = repository.observeLiveEarnings().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)
    val clockableJobs = jobDao.observeAll()
        .map { jobs -> jobs.filter { it.status in CLOCKABLE_JOB_STATUSES } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), emptyList())

    fun clockIn(jobId: String?, lat: Double, lng: Double) = viewModelScope.launch {
        repository.clockIn(jobId, lat, lng, authRepository.currentHourlyRateCents)
    }

    fun clockOut(lat: Double, lng: Double) = viewModelScope.launch {
        activeTimecard.value?.let { repository.clockOut(it, lat, lng) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClockInScreen(viewModel: ClockInViewModel = hiltViewModel()) {
    val active by viewModel.activeTimecard.collectAsState()
    val earnings by viewModel.liveEarnings.collectAsState()
    val clockableJobs by viewModel.clockableJobs.collectAsState()
    val location = rememberCurrentLocation()

    var selectedJob by remember { mutableStateOf<JobEntity?>(null) }
    var dropdownExpanded by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Work Times", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(24.dp))

        if (active != null && earnings != null) {
            val e: LiveEarnings = earnings!!
            Text("$${"%.2f".format(e.earningsCents / 100.0)}", style = MaterialTheme.typography.displayMedium)
            Text("${e.activeMinutes / 60}h ${e.activeMinutes % 60}m active${if (e.onBreak) " (on break)" else ""}")
            Spacer(Modifier.height(24.dp))
            Button(onClick = { location?.let { viewModel.clockOut(it.first, it.second) } }, enabled = location != null) {
                Text(if (location != null) "Clock out" else "Getting your location…")
            }
        } else {
            ExposedDropdownMenuBox(expanded = dropdownExpanded, onExpandedChange = { dropdownExpanded = it }) {
                OutlinedTextField(
                    value = selectedJob?.let { "${it.jobNumber} — ${it.title}" } ?: "No job (general clock-in)",
                    onValueChange = {},
                    readOnly = true,
                    label = { Text("Job") },
                    trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = dropdownExpanded) },
                    modifier = Modifier.fillMaxWidth().menuAnchor(),
                )
                ExposedDropdownMenu(expanded = dropdownExpanded, onDismissRequest = { dropdownExpanded = false }) {
                    DropdownMenuItem(text = { Text("No job (general clock-in)") }, onClick = { selectedJob = null; dropdownExpanded = false })
                    clockableJobs.forEach { job ->
                        DropdownMenuItem(
                            text = { Text("${job.jobNumber} — ${job.title}") },
                            onClick = { selectedJob = job; dropdownExpanded = false },
                        )
                    }
                }
            }
            if (selectedJob != null) {
                Text(
                    "Clock-in location is checked against this job's geofence.",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            Spacer(Modifier.height(16.dp))
            Button(onClick = { location?.let { viewModel.clockIn(selectedJob?.id, it.first, it.second) } }, enabled = location != null) {
                Text(if (location != null) "Clock in" else "Getting your location…")
            }
        }
    }
}
