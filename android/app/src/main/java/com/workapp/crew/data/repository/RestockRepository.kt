package com.workapp.crew.data.repository

import com.workapp.crew.data.remote.ApiService
import com.workapp.crew.data.remote.CreateRestockRequest
import com.workapp.crew.data.remote.FulfillRestockResponse
import com.workapp.crew.data.remote.RestockItemDto
import com.workapp.crew.data.remote.UpdateRestockRequest
import javax.inject.Inject
import javax.inject.Singleton

/** Out Of Inventory: a shared running list of materials to buy or replace — not per-technician,
 * not tied to a job. Matches web/src/pages/OutOfInventoryPage.tsx exactly (same endpoints). */
@Singleton
class RestockRepository @Inject constructor(private val api: ApiService) {
    suspend fun list(): List<RestockItemDto> = api.getRestockRequests()

    suspend fun create(itemName: String, unit: String, quantityNeeded: Double, note: String?) {
        api.createRestockRequest(CreateRestockRequest(itemName, unit, quantityNeeded, note))
    }

    suspend fun setQuantity(id: String, quantityNeeded: Double) {
        api.updateRestockRequest(id, UpdateRestockRequest(quantityNeeded = quantityNeeded))
    }

    suspend fun remove(id: String) {
        api.deleteRestockRequest(id)
    }

    /** Credits the requested quantity to the caller's Material Ledger and clears the request —
     * matches the web app's "Restocked" button (POST .../fulfill instead of a plain DELETE). */
    suspend fun fulfill(id: String): FulfillRestockResponse = api.fulfillRestockRequest(id)
}
