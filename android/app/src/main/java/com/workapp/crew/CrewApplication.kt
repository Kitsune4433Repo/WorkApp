package com.workapp.crew

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.workapp.crew.data.remote.AuthTokenStore
import com.workapp.crew.sync.SyncWorker
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class CrewApplication : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory
    @Inject lateinit var tokenStore: AuthTokenStore

    override fun onCreate() {
        super.onCreate()
        SyncWorker.schedulePeriodic(this)
        // Covers reopening the app already logged in (e.g. the next day) — otherwise Room-backed
        // screens can sit stale until the 15-minute periodic worker's next run.
        if (tokenStore.accessToken != null) SyncWorker.triggerImmediateSync(this)
    }

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().setWorkerFactory(workerFactory).build()
}
