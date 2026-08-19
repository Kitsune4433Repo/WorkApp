package com.workapp.crew.data.repository

import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.CreateUserRequest
import com.workapp.crew.data.remote.SetUserActiveRequest
import com.workapp.crew.data.remote.UserListItemDto
import javax.inject.Inject
import javax.inject.Singleton

/** Admin-only account provisioning — matches web/src/pages/UserManagementPage.tsx. There's
 * deliberately no public sign-up; an admin creates accounts here for real people. */
@Singleton
class UsersRepository @Inject constructor(private val api: ApiService) {
    suspend fun list(): List<UserListItemDto> = api.getUsers()

    suspend fun create(email: String, password: String, fullName: String, role: String, hourlyRateCents: Int) {
        api.createUser(CreateUserRequest(email, password, fullName, role, hourlyRateCents))
    }

    suspend fun setActive(id: String, isActive: Boolean) {
        api.setUserActive(id, SetUserActiveRequest(isActive))
    }

    suspend fun delete(id: String) {
        api.deleteUser(id)
    }
}
