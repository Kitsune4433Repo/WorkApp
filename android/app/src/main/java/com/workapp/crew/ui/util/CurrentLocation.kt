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
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

/**
 * Requests ACCESS_FINE_LOCATION (if not already granted) and resolves a single high-accuracy fix,
 * shared by Clock In (geofence check) and the Job Board's "use my current location" create-job
 * flow. Returns null until permission is granted and a fix resolves — callers should treat that as
 * "not ready yet" rather than an error; there's no distinct denied-vs-pending state here because
 * both screens already just disable their location-dependent action while this is null.
 */
@Composable
fun rememberCurrentLocation(): Pair<Double, Double>? {
    val context = LocalContext.current
    var location by remember { mutableStateOf<Pair<Double, Double>?>(null) }
    var hasPermission by remember {
        mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED)
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        hasPermission = granted
    }

    LaunchedEffect(Unit) {
        if (!hasPermission) permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
    }

    LaunchedEffect(hasPermission) {
        if (!hasPermission) return@LaunchedEffect
        val fusedLocationClient = LocationServices.getFusedLocationProviderClient(context)
        val request = CurrentLocationRequest.Builder().setPriority(Priority.PRIORITY_HIGH_ACCURACY).build()
        fusedLocationClient.getCurrentLocation(request, CancellationTokenSource().token)
            .addOnSuccessListener { loc -> loc?.let { location = it.latitude to it.longitude } }
    }

    return location
}
