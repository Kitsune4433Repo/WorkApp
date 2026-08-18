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
import com.workapp.crew.data.repository.AuthRepository
import com.workapp.crew.data.repository.LiveEarnings
import com.workapp.crew.data.repository.TimecardRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class ClockInViewModel @Inject constructor(
    private val repository: TimecardRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {
    val activeTimecard = repository.observeActive().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)
    val liveEarnings = repository.observeLiveEarnings().stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    fun clockIn(jobId: String?, lat: Double, lng: Double) = viewModelScope.launch {
        repository.clockIn(jobId, lat, lng, authRepository.currentHourlyRateCents)
    }

    fun clockOut(lat: Double, lng: Double) = viewModelScope.launch {
        activeTimecard.value?.let { repository.clockOut(it, lat, lng) }
    }
}

@Composable
fun ClockInScreen(viewModel: ClockInViewModel = hiltViewModel()) {
    val active by viewModel.activeTimecard.collectAsState()
    val earnings by viewModel.liveEarnings.collectAsState()
    val location = rememberCurrentLocation()

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
            Button(onClick = { location?.let { viewModel.clockOut(it.first, it.second) } }) {
                Text("Clock out")
            }
        } else {
            Button(onClick = { location?.let { viewModel.clockIn(null, it.first, it.second) } }) {
                Text("Clock in")
            }
        }
    }
}

/** Placeholder for a FusedLocationProviderClient-backed current-location holder used across screens. */
@Composable
private fun rememberCurrentLocation(): Pair<Double, Double>? {
    var location by remember { mutableStateOf<Pair<Double, Double>?>(null) }
    // Real implementation requests a single high-accuracy fix via FusedLocationProviderClient
    // (see LocationTrackingService for the equivalent background-tracking setup) and updates
    // `location` once resolved, guarded by the ACCESS_FINE_LOCATION runtime permission.
    return location
}
