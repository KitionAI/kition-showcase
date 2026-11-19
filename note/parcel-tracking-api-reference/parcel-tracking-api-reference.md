# Parcel Tracking API

Version 2 · Base URL `https://api.parcelpost.example/v2` · All responses are JSON. Failures use the codes listed under [[#Errors]].

## Get a parcel

```http
GET /parcels/{tracking_id}?events=10
Authorization: Bearer <token>
```

| Parameter | In | Type | Limit |
| --- | --- | --- | --: |
| `tracking_id` | path | string | 12 to 20 chars |
| `events` | query | integer | 1 to 50 |
| `lang` | query | string | 2 letters |

### Response

```json
{
  "tracking_id": "PP4471920583GB",
  "status": "out_for_delivery",
  "eta": "2026-11-10T14:00:00Z",
  "events": [
    { "at": "2026-11-10T06:12:00Z", "place": "Leeds depot", "code": "OFD" }
  ]
}
```

### Example

```sh
curl -H "Authorization: Bearer $TOKEN" \
  https://api.parcelpost.example/v2/parcels/PP4471920583GB
```

## Errors

| Status | Code | When |
| :-: | --- | --- |
| 401 | `auth_missing` | No or expired token |
| 404 | `not_found` | Unknown tracking id |
| 429 | `rate_limited` | Over 60 requests a minute |

> [!NOTE] Rate limits
> The `Retry-After` header says how many seconds to wait.
