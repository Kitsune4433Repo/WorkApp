package com.workapp.crew.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "chat_channels")
data class ChatChannelEntity(
    @PrimaryKey val id: String,
    val type: String,
    val name: String?,
    val jobId: String?,
)

@Entity(tableName = "chat_messages")
data class ChatMessageEntity(
    @PrimaryKey val clientMsgId: String,
    val serverId: String?,
    val channelId: String,
    val senderId: String,
    val body: String?,
    val attachmentLocalPath: String?,
    val sentAt: Long,
    val synced: Boolean = false,
)
