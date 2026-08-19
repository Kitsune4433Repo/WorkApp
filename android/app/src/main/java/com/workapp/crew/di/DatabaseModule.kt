package com.workapp.crew.di

import android.content.Context
import androidx.room.Room
import com.workapp.crew.data.local.AppDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, AppDatabase.DATABASE_NAME)
            // This DB is a pure cache SyncWorker fully repopulates from the server — safe to just
            // wipe and re-sync on a schema bump rather than hand-writing migrations for a pre-1.0 app.
            .fallbackToDestructiveMigration()
            .fallbackToDestructiveMigrationOnDowngrade()
            .build()

    @Provides
    fun provideJobDao(db: AppDatabase) = db.jobDao()

    @Provides
    fun provideInventoryDao(db: AppDatabase) = db.inventoryDao()

    @Provides
    fun provideTimecardDao(db: AppDatabase) = db.timecardDao()

    @Provides
    fun provideDocumentDao(db: AppDatabase) = db.documentDao()

    @Provides
    fun provideChatDao(db: AppDatabase) = db.chatDao()
}
