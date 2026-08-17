# DingTalk Calendar

OctoBus service for DingTalk calendar list, create, get, update, delete, attendee add/remove, meeting-room search/busy query, and room add/remove operations.

Update, delete, and attendee mutations require a stable event ID and an explicit `corpId:userId` profile.
Attendee mutations use the dedicated DWS `calendar attendee add/delete` commands; they are not fields of `UpdateEvent`.
Event reads preserve DingTalk's status so cancellation can be verified from the exact event ID.
Room operations require an explicit profile and stable event/room IDs, and map to the dedicated DWS room/busy commands.
