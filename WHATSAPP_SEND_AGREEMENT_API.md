# WhatsApp Send Agreement API Documentation

This API endpoint allows external websites, backend servers, and webhooks to send **PDF agreement documents** with **accompanying text** directly to customers via WhatsApp.

---

## Endpoint Details

- **Method**: `POST`
- **Path**: `/api/whatsapp/send-agreement`
- **Production URL**: `https://holyminicow.com/crm-beta/api/whatsapp/send-agreement`

---

## Key Features & Behavior

1. **New Leads ("Even if he is not there")**:
   - The recipient does **not** need to have messaged your WhatsApp account previously.
   - The phone number does **not** need to be saved in CRM beforehand. If it's a new number, the system automatically registers the lead with default status **`Joined`** and auto-assigns the lead to an active sales representative via round-robin.
2. **Strict WhatsApp Registration Verification**:
   - Before attempting to send, the server queries WhatsApp servers using `sock.onWhatsApp(phone)`.
   - If the number is **not registered on WhatsApp**, the request is immediately rejected with HTTP `400` (`NOT_ON_WHATSAPP`) before any messages or files are stored.
3. **Strict PDF Format Only**:
   - Validates that the remote file or upload is strictly an `application/pdf` (checking both MIME type and `%PDF-` binary magic bytes).
4. **Phone Number Auto-Sanitization**:
   - Automatically strips spaces, hyphens, and symbols.
   - 10-digit Indian numbers (`9876543210`) automatically receive the `91` country code prefix (`919876543210`).

---

## Request Parameters

You only need to pass **`number`** and **`document`**. Everything else is optional:

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `number` | `string` | **YES** | Recipient's phone number (e.g. `"9876543210"`, `"+91 98765 43210"`). Auto-sanitized with country code `91`. |
| `document` | `string` | **YES** | Public URL of the agreement PDF on your website (e.g. `"https://yourwebsite.com/agreements/agreement_123.pdf"`). |
| `text` / `caption` | `string` | Optional | Accompanying text message (defaults to a friendly agreement message if omitted). |
| `name` | `string` | Optional | Recipient name (defaults to `"Valued Customer"`). |
| `status` | `string` | Optional | Lead status (defaults to **`"Joined"`** for agreement leads). |
| `assignedTo` | `string` | Optional | Name of sales rep to assign to (defaults to round-robin auto-assignment across active sales reps). |
| `service` | `string` | Optional | Lead service (e.g., `"Grooming"`, `"Training"`, `"Walking"`). Defaults to `"General Enquiry"`. |
| `fileName` | `string` | Optional | Filename displayed in WhatsApp (defaults to `"Petsfolio_Agreement.pdf"`). |
| `leadId` | `string` | Optional | Not needed. Only pass if linking to an existing CRM lead explicitly. |

*(Note: `phone` is also accepted as alias for `number`, and `pdfUrl` is accepted as alias for `document`).*

---

## 1. Success Examples

### Standard Request (`number`, `document`, and `text`)

```bash
curl -X POST "https://holyminicow.com/crm-beta/api/whatsapp/send-agreement" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "9876543210",
    "document": "https://yourwebsite.com/agreements/client_agreement.pdf",
    "text": "Dear Customer, please find attached your Petsfolio Service Agreement. Kindly review and confirm to proceed. Thank you!"
  }'
```

### Minimal Request (Only `number` and `document`, uses default polite text)

```bash
curl -X POST "https://holyminicow.com/crm-beta/api/whatsapp/send-agreement" \
  -H "Content-Type: application/json" \
  -d '{
    "number": "9876543210",
    "document": "https://yourwebsite.com/agreements/client_agreement.pdf"
  }'
```



#### Success Response (`200 OK`)

```json
{
  "success": true,
  "message": "Agreement PDF sent successfully via WhatsApp.",
  "data": {
    "messageId": "3EB0C824...719",
    "leadId": "6741b8a91c...",
    "leadName": "Rahul Sharma",
    "phone": "919876543210",
    "whatsappJid": "919876543210@s.whatsapp.net",
    "fileName": "Petsfolio_Service_Agreement_Rahul.pdf",
    "mediaUrl": "/uploads/agreements/agreement_1727685600_ab12c.pdf",
    "caption": "Dear Rahul, please find attached the Petsfolio Service Agreement for your pet's grooming session. Kindly review and confirm to proceed. Thank you!",
    "sentAt": "2026-09-30T07:42:00.000Z"
  }
}
```

---

### Example 2: Direct PDF Upload via Multipart Form

```bash
curl -X POST "https://holyminicow.com/crm-beta/api/whatsapp/send-agreement" \
  -F "phone=9876543210" \
  -F "name=Sneha Patel" \
  -F "text=Dear Sneha, please review your customized pet care agreement." \
  -F "fileName=Pet_Boarding_Agreement.pdf" \
  -F "file=@/path/to/local/contract.pdf"
```

#### Success Response (`200 OK`)

```json
{
  "success": true,
  "message": "Agreement PDF sent successfully via WhatsApp.",
  "data": {
    "messageId": "3EB042E9...911",
    "leadId": "6741b99f2a...",
    "leadName": "Sneha Patel",
    "phone": "919876543210",
    "whatsappJid": "919876543210@s.whatsapp.net",
    "fileName": "Pet_Boarding_Agreement.pdf",
    "mediaUrl": "/uploads/agreements/agreement_1727685820_9x81f.pdf",
    "caption": "Dear Sneha, please review your customized pet care agreement.",
    "sentAt": "2026-09-30T07:45:00.000Z"
  }
}
```

---

### Example 3: Send by Existing CRM `leadId`

```bash
curl -X POST "https://holyminicow.com/crm-beta/api/whatsapp/send-agreement" \
  -H "Content-Type: application/json" \
  -d '{
    "leadId": "6741b8a91c...",
    "pdfUrl": "https://yourwebsite.com/agreements/agreement_789.pdf",
    "text": "Hi Rahul, here is your service agreement copy."
  }'
```

---

## 2. Error Scenarios & Responses

### Error 1: Phone Number is NOT on WhatsApp (`400 Bad Request`)

When the phone number is not registered on WhatsApp:

#### Request

```bash
curl -X POST "https://holyminicow.com/crm-beta/api/whatsapp/send-agreement" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "9000000000",
    "pdfUrl": "https://yourwebsite.com/contract.pdf"
  }'
```

#### Response (`400 Bad Request`)

```json
{
  "success": false,
  "error": "NOT_ON_WHATSAPP",
  "phone": "919000000000",
  "message": "The phone number +919000000000 is not registered on WhatsApp."
}
```

---

### Error 2: WhatsApp Client is Disconnected (`400 Bad Request`)

When the CRM WhatsApp session has been logged out or is not connected:

#### Response (`400 Bad Request`)

```json
{
  "success": false,
  "error": "WHATSAPP_DISCONNECTED",
  "message": "WhatsApp client is not connected! Please connect WhatsApp session before sending."
}
```

---

### Error 3: Remote URL Does Not Return a PDF (`400 Bad Request`)

When `pdfUrl` points to an HTML page, image, or non-PDF file:

#### Response (`400 Bad Request`)

```json
{
  "success": false,
  "error": "INVALID_PDF",
  "message": "The provided 'pdfUrl' does not point to a valid PDF document."
}
```

---

### Error 4: Remote PDF Download Failed / Timeout (`400 Bad Request`)

When the remote website returns 404 or connection times out:

#### Response (`400 Bad Request`)

```json
{
  "success": false,
  "error": "PDF_FETCH_FAILED",
  "message": "Failed to download PDF from provided URL (https://yourwebsite.com/bad-url.pdf): Request failed with status code 404"
}
```

---

### Error 5: Missing Phone / `leadId` (`400 Bad Request`)

```json
{
  "success": false,
  "error": "MISSING_PHONE",
  "message": "Either 'phone' or a valid 'leadId' must be provided."
}
```

---

### Error 6: Missing PDF Source (`400 Bad Request`)

```json
{
  "success": false,
  "error": "MISSING_PDF",
  "message": "Please provide 'pdfUrl' or upload a PDF file."
}
```

---

## 3. Code Integration Examples

### Node.js / Express (Axios)

```javascript
import axios from "axios";

async function sendAgreementToLead(
  customerPhone,
  customerName,
  agreementUrl,
  messageText,
) {
  try {
    const response = await axios.post(
      "https://holyminicow.com/crm-beta/api/whatsapp/send-agreement",
      {
        phone: customerPhone,
        name: customerName,
        pdfUrl: agreementUrl,
        text: messageText,
        fileName: "Petsfolio_Service_Agreement.pdf",
      },
    );

    console.log("Agreement dispatched successfully:", response.data);
    return response.data;
  } catch (error) {
    if (error.response?.data?.error === "NOT_ON_WHATSAPP") {
      console.error(
        "Customer does not have WhatsApp:",
        error.response.data.message,
      );
    } else {
      console.error(
        "Failed to send agreement:",
        error.response?.data || error.message,
      );
    }
    throw error;
  }
}
```

### Python

```python
import requests

def send_agreement(phone, name, pdf_url, text):
    url = "https://holyminicow.com/crm-beta/api/whatsapp/send-agreement"
    payload = {
        "phone": phone,
        "name": name,
        "pdfUrl": pdf_url,
        "text": text,
        "fileName": "Petsfolio_Service_Agreement.pdf"
    }

    response = requests.post(url, json=payload)
    data = response.json()

    if response.status_code == 200:
        print("Sent successfully! Message ID:", data["data"]["messageId"])
    elif data.get("error") == "NOT_ON_WHATSAPP":
        print("Phone number is not registered on WhatsApp.")
    else:
        print("Error sending agreement:", data.get("message"))

    return data
```

### PHP (cURL)

```php
<?php
$data = [
    'phone' => '9876543210',
    'name'  => 'Rahul Sharma',
    'pdfUrl' => 'https://yourwebsite.com/agreements/agreement_101.pdf',
    'text'  => 'Dear Rahul, please find your Petsfolio Agreement attached.',
    'fileName' => 'Petsfolio_Agreement.pdf'
];

$ch = curl_init('https://holyminicow.com/crm-beta/api/whatsapp/send-agreement');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode($response, true);
if ($httpCode === 200) {
    echo "Agreement sent! Message ID: " . $result['data']['messageId'];
} else {
    echo "Error: " . $result['message'];
}
?>
```
