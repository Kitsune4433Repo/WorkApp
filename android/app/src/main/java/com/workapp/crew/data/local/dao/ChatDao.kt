package com.workapp.crew.data.local.dao

import androidx.room.*
import com.workapp.crew.data.local.entities.ChatChannelEntity
import com.workapp.crew.data.local.entities.ChatMessageEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface ChatDao {
    @Query("SELECT * FROM chat_channels")
    fun observeChannels(): Flow<List<ChatChannelEntity>>

    @Upsert
    suspend fun upsertChannels(channels: List<ChatChannelEntity>)

    @Query("SELECT * FROM chat_messages WHERE channelId = :channelId ORDER BY sentAt ASC")
    fun observeMessages(channelId: String): Flow<List<ChatMessageEntity>>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertMessage(message: ChatMessageEntity)

    @Query("SELECT * FROM chat_messages WHERE synced = 0")
    suspend fun getUnsyncedMessages(): List<ChatMessageEntity>

    @Query("UPDATE chat_messages SET synced = 1, serverId = :serverId WHERE clientMsgId = :clientMsgId")
    suspend fun markSynced(clientMsgId: String, serverId: String)

    @Query("DELETE FROM chat_channels WHERE id = :channelId")
    suspend fun deleteChannel(channelId: String)

    @Query("DELETE FROM chat_messages WHERE channelId = :channelId")
    suspend fun deleteMessagesForChannel(channelId: String)
}
