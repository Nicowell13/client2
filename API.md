# API Documentation

Base URL: `http://localhost:4000`

## Authentication

Currently no authentication is required. For production, implement JWT authentication.

## Sessions API

### Create Session

Creates a new WhatsApp session.

**Endpoint:** `POST /api/sessions`

**Request Body:**
```json
{
  "name": "default"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clx1234567890",
    "name": "default",
    "sessionId": "default",
    "status": "starting",
    "qrCode": null,
    "phoneNumber": null,
    "isDefault": true,
    "createdAt": "2024-12-01T10:00:00.000Z",
    "updatedAt": "2024-12-01T10:00:00.000Z"
  }
}
```

### Get All Sessions

**Endpoint:** `GET /api/sessions`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx1234567890",
      "name": "default",
      "sessionId": "default",
      "status": "working",
      "qrCode": null,
      "phoneNumber": "6281234567890",
      "createdAt": "2024-12-01T10:00:00.000Z",
      "updatedAt": "2024-12-01T10:05:00.000Z"
    }
  ]
}
```

### Get Session by ID

**Endpoint:** `GET /api/sessions/:id`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clx1234567890",
    "name": "default",
    "status": "working",
    "phoneNumber": "6281234567890"
  }
}
```

### Get QR Code

**Endpoint:** `GET /api/sessions/:id/qr`

**Response:**
```json
{
  "success": true,
  "data": {
    "qr": "data:image/png;base64,iVBORw0KG..."
  }
}
```

### Stop Session

**Endpoint:** `POST /api/sessions/:id/stop`

**Response:**
```json
{
  "success": true,
  "message": "Session stopped successfully"
}
```

### Delete Session

**Endpoint:** `DELETE /api/sessions/:id`

**Response:**
```json
{
  "success": true,
  "message": "Session deleted successfully"
}
```

## Contacts API

### Upload CSV

Upload contacts from CSV file.

**Endpoint:** `POST /api/contacts/upload`

**Request:**
- Content-Type: `multipart/form-data`
- Field name: `file`
- File type: `.csv`

**CSV Format:**
```csv
name,phoneNumber,email
John Doe,628123456789,john@example.com
Jane Smith,628987654321,jane@example.com
```

**Response:**
```json
{
  "success": true,
  "message": "5 contacts imported successfully",
  "data": [...]
}
```

### Get All Contacts

**Endpoint:** `GET /api/contacts`

**Query Parameters:**
- `page` (optional): Page number, default 1
- `limit` (optional): Items per page, default 50
- `search` (optional): Search by name or phone

**Example:** `GET /api/contacts?page=1&limit=20&search=john`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx1234567890",
      "name": "John Doe",
      "phoneNumber": "628123456789",
      "email": "john@example.com",
      "tags": [],
      "createdAt": "2024-12-01T10:00:00.000Z",
      "updatedAt": "2024-12-01T10:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

### Create Contact

**Endpoint:** `POST /api/contacts`

**Request Body:**
```json
{
  "name": "John Doe",
  "phoneNumber": "628123456789",
  "email": "john@example.com"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clx1234567890",
    "name": "John Doe",
    "phoneNumber": "628123456789",
    "email": "john@example.com"
  }
}
```

### Delete Contact

**Endpoint:** `DELETE /api/contacts/:id`

**Response:**
```json
{
  "success": true,
  "message": "Contact deleted successfully"
}
```

## Campaigns API

### Create Campaign

**Endpoint:** `POST /api/campaigns`

**Request Body:**
```json
{
  "name": "Flash Sale 50%",
  "message": "Halo! Flash Sale 50% hari ini!",
  "imageUrl": "https://example.com/promo.jpg",
  "sessionId": "clx1234567890",
  "buttons": [
    {
      "label": "Belanja Sekarang",
      "url": "https://tokosaya.com/sale"
    },
    {
      "label": "Lihat Katalog",
      "url": "https://tokosaya.com/catalog"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clx9876543210",
    "name": "Flash Sale 50%",
    "message": "Halo! Flash Sale 50% hari ini!",
    "imageUrl": "https://example.com/promo.jpg",
    "status": "draft",
    "sessionId": "clx1234567890",
    "totalContacts": 0,
    "sentCount": 0,
    "failedCount": 0,
    "buttons": [
      {
        "id": "btn1",
        "label": "Belanja Sekarang",
        "url": "https://tokosaya.com/sale",
        "order": 1
      },
      {
        "id": "btn2",
        "label": "Lihat Katalog",
        "url": "https://tokosaya.com/catalog",
        "order": 2
      }
    ],
    "createdAt": "2024-12-01T10:00:00.000Z",
    "updatedAt": "2024-12-01T10:00:00.000Z"
  }
}
```

### Get All Campaigns

**Endpoint:** `GET /api/campaigns`

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "clx9876543210",
      "name": "Flash Sale 50%",
      "status": "draft",
      "totalContacts": 100,
      "sentCount": 0,
      "failedCount": 0,
      "buttons": [...],
      "session": {
        "name": "default",
        "status": "working"
      },
      "_count": {
        "messages": 0
      }
    }
  ]
}
```

### Get Campaign by ID

**Endpoint:** `GET /api/campaigns/:id`

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "clx9876543210",
    "name": "Flash Sale 50%",
    "message": "Halo! Flash Sale 50% hari ini!",
    "status": "sent",
    "buttons": [...],
    "session": {...},
    "messages": [
      {
        "id": "msg1",
        "status": "sent",
        "contact": {
          "name": "John Doe",
          "phoneNumber": "628123456789"
        }
      }
    ]
  }
}
```

### Send Campaign

**Endpoint:** `POST /api/campaigns/:id/send`

**Request Body:**
```json
{
  "contactIds": ["clx111", "clx222"]  // Optional, null = all contacts
}
```

**Response:**
```json
{
  "success": true,
  "message": "Campaign queued for 100 contacts",
  "data": {
    "campaignId": "clx9876543210",
    "totalContacts": 100
  }
}
```

### Update Campaign

**Endpoint:** `PUT /api/campaigns/:id`

**Request Body:**
```json
{
  "name": "Updated Campaign Name",
  "message": "Updated message",
  "imageUrl": "https://example.com/new-image.jpg",
  "buttons": [...]
}
```

**Response:**
```json
{
  "success": true,
  "data": {...}
}
```

### Delete Campaign

**Endpoint:** `DELETE /api/campaigns/:id`

**Response:**
```json
{
  "success": true,
  "message": "Campaign deleted successfully"
}
```

## Webhooks

### WhatsApp Webhook

This endpoint receives webhooks from WAHA.

**Endpoint:** `POST /webhook/whatsapp`

**Request Body:**
```json
{
  "event": "session.status",
  "session": "default",
  "payload": {
    "status": "working"
  }
}
```

## Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "message": "Error message here"
}
```

### Common Error Codes

- `400` - Bad Request (missing required fields)
- `404` - Not Found (resource doesn't exist)
- `500` - Internal Server Error

## Status Values

### Session Status
- `stopped` - Session is not active
- `starting` - Session is being initialized
- `working` - Session is active and connected
- `failed` - Session failed to connect

### Campaign Status
- `draft` - Campaign created but not sent
- `sending` - Campaign is being sent
- `sent` - Campaign completed
- `failed` - Campaign failed

### Message Status
- `pending` - Message in queue
- `sent` - Message sent to WhatsApp
- `delivered` - Message delivered to recipient
- `failed` - Message failed to send

## Rate Limits

For WAHA free version:
- Max 1000 messages per day per session
- Recommended delay: 2-3 seconds between messages (handled automatically by queue)

## Notes

1. Phone numbers must be in international format without + (e.g., 628123456789)
2. Images must be publicly accessible URLs
3. Buttons are limited to maximum 2 per message
4. Session must be in "working" status to send messages
5. All timestamps are in ISO 8601 format (UTC)
