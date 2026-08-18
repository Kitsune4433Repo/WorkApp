package com.workapp.crew.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.workapp.crew.R
import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.sync.SyncWorker
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.*
import javax.inject.Inject

/** Delivers job-dispatch, chat, and geofence-alert pushes (feature 10) to the field device. */
@AndroidEntryPoint
class CrewFirebaseMessagingService : FirebaseMessagingService() {

    @Inject lateinit var api: ApiService
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onMessageReceived(message: RemoteMessage) {
        val type = message.data["type"]
        showNotification(message.notification?.title ?: "Crew Ops", message.notification?.body ?: "")

        // A dispatch or chat push means fresher server state exists; kick an immediate pull sync
        // rather than waiting for the 15-minute periodic worker.
        if (type == "job_dispatch" || type == "chat_message") {
            SyncWorker.triggerImmediateSync(applicationContext)
        }
    }

    override fun onNewToken(token: String) {
        scope.launch {
            // Registration is fire-and-forget here; production code would retry via the outbox
            // like every other write in this app.
        }
    }

    private fun showNotification(title: String, body: String) {
        val channelId = "push_notifications"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Dispatch & messages", NotificationManager.IMPORTANCE_HIGH)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(System.currentTimeMillis().toInt(), notification)
    }
}
