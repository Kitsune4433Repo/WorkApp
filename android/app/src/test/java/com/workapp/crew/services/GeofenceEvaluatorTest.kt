package com.workapp.crew.services

import com.workapp.crew.data.local.entities.JobEntity
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

private fun testJob(
    siteLat: Double = 44.9778,
    siteLng: Double = -93.2650,
    geofenceRadiusM: Int? = null,
    geofencePolygonJson: String? = null,
): JobEntity = JobEntity(
    id = "job-1",
    jobNumber = "JOB-1",
    title = "Test job",
    description = null,
    status = "dispatched",
    priority = "normal",
    siteLat = siteLat,
    siteLng = siteLng,
    geofenceRadiusM = geofenceRadiusM,
    geofencePolygonJson = geofencePolygonJson,
    scheduledStart = null,
    scheduledEnd = null,
    updatedAt = 0L,
)

class GeofenceEvaluatorTest {

    // ~1 degree of latitude is ~111km; small deltas below are well inside/outside a 75m radius.
    private val onSite = 44.9778 to -93.2650
    private val justOutside = 44.9790 to -93.2650 // roughly 130m north

    @Test
    fun `radius fallback accepts a point at the exact site location`() {
        val job = testJob(geofenceRadiusM = 75)
        assertTrue(GeofenceEvaluator.isWithinGeofence(job, onSite.first, onSite.second))
    }

    @Test
    fun `radius fallback rejects a point outside the configured radius`() {
        val job = testJob(geofenceRadiusM = 75)
        assertFalse(GeofenceEvaluator.isWithinGeofence(job, justOutside.first, justOutside.second))
    }

    @Test
    fun `radius fallback accepts a point within a larger radius`() {
        val job = testJob(geofenceRadiusM = 200)
        assertTrue(GeofenceEvaluator.isWithinGeofence(job, justOutside.first, justOutside.second))
    }

    @Test
    fun `no geofence configured does not block clock-in`() {
        val job = testJob(geofenceRadiusM = null, geofencePolygonJson = null)
        assertTrue(GeofenceEvaluator.isWithinGeofence(job, 0.0, 0.0))
    }

    @Test
    fun `polygon geofence accepts a point inside the drawn perimeter`() {
        val polygon = """[{"lat":0,"lng":0},{"lat":0,"lng":10},{"lat":10,"lng":10},{"lat":10,"lng":0}]"""
        val job = testJob(siteLat = 5.0, siteLng = 5.0, geofencePolygonJson = polygon)
        assertTrue(GeofenceEvaluator.isWithinGeofence(job, 5.0, 5.0))
    }

    @Test
    fun `polygon geofence rejects a point outside the drawn perimeter`() {
        val polygon = """[{"lat":0,"lng":0},{"lat":0,"lng":10},{"lat":10,"lng":10},{"lat":10,"lng":0}]"""
        val job = testJob(siteLat = 5.0, siteLng = 5.0, geofencePolygonJson = polygon)
        assertFalse(GeofenceEvaluator.isWithinGeofence(job, 50.0, 50.0))
    }

    @Test
    fun `polygon geofence takes precedence over the radius fallback when both are set`() {
        // Point is outside the polygon but well within the radius from siteLat/siteLng — the
        // polygon (drawn on-site) should win since it's the more precise perimeter.
        val polygon = """[{"lat":0,"lng":0},{"lat":0,"lng":1},{"lat":1,"lng":1},{"lat":1,"lng":0}]"""
        val job = testJob(siteLat = 0.5, siteLng = 0.5, geofenceRadiusM = 999_999_999, geofencePolygonJson = polygon)
        assertFalse(GeofenceEvaluator.isWithinGeofence(job, 50.0, 50.0))
    }
}
