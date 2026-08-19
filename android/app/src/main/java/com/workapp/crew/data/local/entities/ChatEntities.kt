package com.workapp.crew.data.local.entities

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "chat_channels")
data class ChatChannelEntity(
    @PrimaryKey val id: String,
    val type: String,
    val name: String?,
    val jobId: String?,
    val createdBy: String?,
)

@Entity(tableName = "chat_messages")
data class ChatMessageEntity(
    @PrimaryKey val clientMsgId: String,
    val serverId: String?,
    val channelId: String,
    val senderId: String,
    val senderFullName: String?,
    val body: String?,
    // The remote key of an image attachment (not a browsable path — resolved to a signed URL just
    // before display, same split as web's ChatAttachmentImage).
    val attachmentUrl: String?,
    val attachmentLocalPath: String?,
    val sentAt: Long,
    val synced: Boolean = false,
)
