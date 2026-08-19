package com.workapp.crew.ui.util

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

sealed class LocationState {
    data object Loading : LocationState()
    data object PermissionDenied : LocationState()
    /** GPS resolved neither a fresh fix nor a cached last-known one — e.g. location services are
     * off, or (indoors/underground) both timed out. */
    data object Unavailable : LocationState()
    data class Available(val lat: Double, val lng: Double) : LocationState()
}

/**
 * Requests ACCESS_FINE_LOCATION (if not already granted) and resolves a fix, shared by Clock In
 * (geofence check) and the Job Board's "use my current location" create-job flow. Falls back to
 * the device's last-known location if a fresh high-accuracy fix doesn't resolve (GPS off, deep
 * indoors, etc.) rather than leaving callers stuck on a spinner forever — and surfaces permission
 * denial and total failure as distinct states so a screen can show something other than an
 * indefinite "Getting your location…" when there's nothing more to wait for.
 */
@Composable
fun rememberCurrentLocation(): LocationState {
    val context = LocalContext.current
    var state by remember { mutableStateOf<LocationState>(LocationState.Loading) }
    var hasPermission by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasPermission = granted
        if (!granted) state = LocationState.PermissionDenied
    }

    LaunchedEffect(Unit) {
        if (!hasPermission) permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    LaunchedEffect(hasPermission) {
        if (!hasPermission) return@LaunchedEffect
        state = LocationState.Loading
        val client = LocationServices.getFusedLocationProviderClient(context)
        val request = CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_HIGH_ACCURACY).setDurationMillis(15_000).build()
        client.getCurrentLocation(request, CancellationTokenSource().token)
            .addOnSuccessListener { loc ->
                if (loc != null) state = LocationState.Available(loc.latitude, loc.longitude)
                else fallBackToLastLocation(client) { state = it }
            }
            .addOnFailureListener { fallBackToLastLocation(client) { state = it } }
    }

    return state
}

private fun fallBackToLastLocation(client: FusedLocationProviderClient, onResult: (LocationState) -> Unit) {
    client.lastLocation
        .addOnSuccessListener { last -> onResult(last?.let { LocationState.Available(it.latitude, it.longitude) } ?: LocationState.Unavailable) }
        .addOnFailureListener { onResult(LocationState.Unavailable) }
}
