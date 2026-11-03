# 📸 P2P Daily

P2P Daily is a **fully decentralized** photo social network experiment. No central server, no database storing your data, and no profiling. Your photos travel directly from your device to your friends' devices.

---

## 🙋‍♀️ For Users: What is it and how does it work?

We are used to social networks where every photo passes through a large company's servers before reaching our friends. P2P Daily changes the rules of the game.

### 🌟 Key Features
* **No Central Database:** Your photos and contacts are saved **only** on your phone (in the browser's memory).
* **Direct Connection (Peer-to-Peer):** When you share a photo, your device creates an invisible, direct "pipe" to your friend's device to transfer the image.
* **Ephemeral Photos:** You can take or upload a maximum of one photo per day. Received photos expire and automatically disappear from the feed when their time is up.
* **Absolute Privacy:** 
  * If you have a **Public Account**, anyone who adds you will receive your photo of the day.
  * If you have a **Private Account**, anyone looking for you must send a "Request". Until you press *Accept*, your device will physically refuse to send your photo's bytes to that person.

### 🚀 How to Get Started
1. Open the app and choose a **Username** (e.g., `marco99`). This name will identify your device on the network.
2. Take or upload your photo of the day.
3. Ask your friends for their Username and enter it in the **"Your friends"** bar.
4. When you are both online, click **Sync**: the phones will find each other and exchange photos in real-time!

---

## 💻 For Developers: Under the Hood

P2P Daily is a **Progressive Web App (PWA)** written in Vanilla JavaScript, HTML, and CSS (Tailwind), based on the **WebRTC** protocol for real-time communications.

### 🏗️ Architecture and Tech Stack
* **Frontend:** HTML5, Tailwind CSS (via CDN/separate file), Vanilla JS.
* **P2P Networking:** [PeerJS](https://peerjs.com/) for WebRTC abstraction.
* **Storage:** Browser `localStorage` API.
* **NAT/Firewall Traversal (ICE):** Serverless Function on **Vercel** (`/api/turn.js`) that communicates with **Twilio** APIs to generate temporary TURN server credentials.
* **PWA:** Manifest and Service Worker (`sw.js`) for installability and offline cache management.

### 🔄 Custom Handshake Protocol
Since there is no central server managing friendships, clients must negotiate privacy by communicating with each other in real-time. We implemented an asynchronous messaging system based on JSON payloads sent via WebRTC `DataConnection`:

1. `follow_request`: Sent when A adds B.
2. `follow_response`: B replies automatically with `status: 'private'` or `status: 'accepted'`.
3. `follow_accepted` / `follow_declined`: Sent when user B (private) presses the UI buttons.
4. `unfollow`: Sent to remove permissions from the other peer's Whitelist in the background.
5. `photo`: The payload containing the image (in compressed Base64) and the timestamp.

### 💾 Local State Management
All persistence logic relies on `localStorage`. The main objects are:
* `p2p_friends`: Array of objects `{ id: "username", status: "pending" | "accepted" }`.
* `p2p_feed`: Object mapped by user containing the photo's timestamp and Base64 string.
* `p2p_allowed`: The "Whitelist" (Followers) of those permitted to receive our WebRTC packets.
* `p2p_requests`: Array of usernames awaiting approval (if the account is private).

### 🛠️ Local Setup and Installation

To run this project locally and explore the code, you need Node.js and the Vercel CLI (since TURN credentials are protected by a Serverless Function).

**1. Clone the repository**
```bash
git clone [https://github.com/your-username/p2p-daily.git](https://github.com/your-username/p2p-daily.git)
cd p2p-daily

```

**2. Configure the Twilio Environment (TURN Server)**
To make WebRTC work even on 4G/5G networks, the app uses Twilio.

* Create a free account on [Twilio](https://www.twilio.com/).
* Navigate to *Network Traversal* to get your `ACCOUNT SID` and `AUTH TOKEN`.
* Create a `.env` file in the project root and insert the keys:

```env
TWILIO_ACCOUNT_SID=your_sid_here
TWILIO_AUTH_TOKEN=your_token_here

```

**3. Start the local development environment**
Install the Vercel CLI (if you haven't already) and start the project:

```bash
npm i -g vercel
vercel dev

```

The app will be available at `http://localhost:3000`.

### 🤝 How to Contribute

Contributions are welcome! The main areas for current improvement include:

* **UI/UX:** Improving loading states during WebRTC negotiation.
* **Image Optimization:** Currently, images are resized via `canvas` to max 800px and compressed into JPEG (0.7 quality) locally before sending. More efficient algorithms (e.g., WebP) can be implemented.
* **Background Sync:** Utilizing Background Sync APIs (where supported) for asynchronous negotiation even when the app is minimized.

Create a *Fork* of the project, make your changes, and open a *Pull Request*!

---

*Developed with passion for a freer and decentralized web.* 🌐

