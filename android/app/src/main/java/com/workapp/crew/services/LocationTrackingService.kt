package com.workapp.crew.services

import android.app.*
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import com.workapp.crew.R
import com.workapp.crew.data.local.dao.TimecardDao
import com.workapp.crew.data.local.entities.LocationPingEntity
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import javax.inject.Inject

/**
 * Foreground service that records background GPS while a technician is clocked in (feature 3).
 * Pings are buffered locally and pushed via SyncWorker — never blocked on connectivity — so
 * tracking survives dead zones common on telecom field sites.
 */
@AndroidEntryPoint
class LocationTrackingService : Service() {

    @Inject lateinit var timecardDao: TimecardDao

    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var activeJobId: String? = null

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val location = result.lastLocation ?: return
            scope.launch {
                timecardDao.insertLocationPing(
                    LocationPingEntity(
                        jobId = activeJobId,
                        lat = location.latitude,
                        lng = location.longitude,
                        accuracyM = location.accuracy,
                        recordedAt = location.time,
                        batteryPct = null,
                    ),
                )
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        activeJobId = intent?.getStringExtra(EXTRA_JOB_ID)
        startForeground(NOTIFICATION_ID, buildNotification())
        startLocationUpdates()
        return START_STICKY
    }

    private fun startLocationUpdates() {
        if (ActivityCompat.checkSelfPermission(this, android.Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            stopSelf()
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, UPDATE_INTERVAL_MS)
            .setMinUpdateIntervalMillis(MIN_UPDATE_INTERVAL_MS)
            .build()
        fusedLocationClient.requestLocationUpdates(request, locationCallback, mainLooper)
    }

    private fun buildNotification(): Notification {
        val channelId = "location_tracking"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Field location tracking", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("Tracking your shift location")
            .setSmallIcon(R.drawable.ic_location_tracking)
            .setOngoing(true)
            .build()
    }

    override fun onDestroy() {
        fusedLocationClient.removeLocationUpdates(locationCallback)
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val EXTRA_JOB_ID = "extra_job_id"
        private const val NOTIFICATION_ID = 4201
        private const val UPDATE_INTERVAL_MS = 60_000L
        private const val MIN_UPDATE_INTERVAL_MS = 30_000L

        fun start(context: android.content.Context, jobId: String?) {
            val intent = Intent(context, LocationTrackingService::class.java).putExtra(EXTRA_JOB_ID, jobId)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
            else context.startService(intent)
        }

        fun stop(context: android.content.Context) {
            context.stopService(Intent(context, LocationTrackingService::class.java))
        }
    }
}
