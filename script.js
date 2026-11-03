// --- CORE LOGIC AND LOCAL STATE ---
let peer;
let myUsername = localStorage.getItem('myUsername');
let connections = [];

const todayString = new Date().toISOString().split('T')[0];
// --- FRIENDS ADDRESS BOOK (Strict format: array of objects) ---
let friends = JSON.parse(localStorage.getItem('p2p_friends')) || [];

// Automatic cleanup: fixes old saves, removes "undefined" and "[object Object]"
friends = friends.map(f => {
    if (typeof f === 'string') return { id: f, status: 'pending' };
    return f;
}).filter(f => 
    f && 
    f.id && 
    typeof f.id === 'string' && 
    f.id !== 'undefined' && 
    !f.id.includes('[object Object]')
);

localStorage.setItem('p2p_friends', JSON.stringify(friends));
// Local Feed State: { "username": { date: "...", image: "..." } }
let feedData = JSON.parse(localStorage.getItem('p2p_feed')) || {};

// --- PRIVACY STATE AND PERMISSIONS ---
let isPrivate = localStorage.getItem('p2p_isPrivate') === 'true';
// Who is allowed to see our photos (Whitelist)
let allowedFollowers = JSON.parse(localStorage.getItem('p2p_allowed')) || [];
// Who requested to follow us
let followRequests = JSON.parse(localStorage.getItem('p2p_requests')) || [];

// Daily cleanup: removes photos from previous days from the local feed
for (let user in feedData) {
    if (feedData[user].date !== todayString) {
        delete feedData[user];
    }
}
localStorage.setItem('p2p_feed', JSON.stringify(feedData));

// --- INITIALIZATION ---
window.onload = () => {
    if (myUsername) {
        showMainApp();
        initPeer(myUsername);
        checkDailyPhoto();
        renderFriends();
        renderTimeline(); // Instantly show photos in memory!
        renderRequests();
        renderFollowers();
    } else {
        showRegistration();
    }
};

// --- UI SECTION MANAGEMENT ---
function showRegistration() {
    document.getElementById('registration-section').classList.remove('hidden');
    document.getElementById('main-app-section').classList.add('hidden');
    document.getElementById('user-badge').classList.add('hidden');
}

function showMainApp() {
    document.getElementById('registration-section').classList.add('hidden');
    document.getElementById('main-app-section').classList.remove('hidden');
    document.getElementById('user-badge').classList.remove('hidden');
}

function registerDevice() {
    let rawInput = document.getElementById('new-username-input').value.trim().toLowerCase();
    let safeUsername = rawInput.replace(/[^a-z0-9]/g, '');

    if (safeUsername.length < 3) {
        showToast("Use at least 3 alphanumeric characters.");
        return;
    }
    myUsername = safeUsername;
    initPeer(myUsername);
}

// --- 1. P2P NETWORK AND CONNECTIONS MANAGEMENT ---
async function initPeer(username) {
    let iceServers = [];

    try {
        showToast("Fetching network credentials...");
        const response = await fetch('/api/turn');
        
        if (response.ok) {
            const data = await response.json();

            // ... (inside initPeer, after receiving the response from /api/turn)
            if (Array.isArray(data)) {
                iceServers = data; // Twilio sends the array directly here sometimes
            } else if (data && Array.isArray(data.iceServers)) {
                iceServers = data.iceServers;
            } else if (data && Array.isArray(data.ice_servers)) {
                iceServers = data.ice_servers; // <--- Handles Twilio's format (with underscore)
            } else {
                throw new Error("Unknown credentials format");
            }

            // --- FIX_START: SECURITY FILTER ---
            // 1. Convert old 'url' formats to the new 'urls' standard
            iceServers = iceServers.map(server => {
                if (server.url && !server.urls) {
                    server.urls = server.url;
                }
                return server;
            });

            // 2. Discard anything that doesn't have a valid address
            iceServers = iceServers.filter(server => server.urls);
            iceServers = iceServers.slice(0, 2);

            // 3. If the array is empty, it means Metered sent us an error
            if (iceServers.length === 0) {
                console.warn("Metered returned an error instead of servers:", data);
            }
            // --- FIX END ---

            // Always add Google's STUN server as a safety net
            iceServers.push({ urls: 'stun:stun.l.google.com:19302' });
            console.log("MY ICE SERVERS ARE:", iceServers);
            
        } else {
            console.warn("TURN API failed, using fallback server.");
            iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
        }
    } catch (error) {
        console.error("Error fetching TURN:", error);
        iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    }

    // 2. Initialize PeerJS with the newly received credentials
    peer = new Peer(username, {
        config: {
            iceServers: iceServers
        }
    });
    
    let reconnectTimeout = 3000; // Dynamic timer that increases if the server acts up
    let isReconnecting = false;

    peer.on('open', (id) => {
        reconnectTimeout = 3000; // Reset timer on successful connection
        localStorage.setItem('myUsername', id);
        document.getElementById('my-peer-id').textContent = id;
        showMainApp();
        checkDailyPhoto();
        showToast("You are online, @" + id);
        
        setTimeout(syncFeed, 1000); 
    });

    peer.on('disconnected', () => {
        if (isReconnecting || peer.destroyed) return;
        
        isReconnecting = true;
        console.log(`Disconnected from server. Retrying in ${reconnectTimeout / 1000} seconds...`);
        
        setTimeout(() => {
            if (peer.disconnected && !peer.destroyed) {
                peer.reconnect();
                // If it fails, next time wait 2 more seconds (max 15 sec)
                reconnectTimeout = Math.min(reconnectTimeout + 2000, 15000);
            }
            isReconnecting = false;
        }, reconnectTimeout);
    });

    peer.on('connection', (conn) => {
        setupConnection(conn);
    });

    peer.on('error', (err) => {
        if (err.type === 'unavailable-id') {
            if (localStorage.getItem('myUsername')) {
                showToast("Warning: You are already connected in another tab.");
                document.getElementById('main-app-section').classList.add('hidden');
            } else {
                showToast("This username is already in use! Choose another one.");
                localStorage.removeItem('myUsername');
                myUsername = null;
                showRegistration();
            }
        } else if (err.type === 'peer-unavailable' || err.message.includes('Could not connect to peer')) {
            console.log("A requested user is currently offline.");
        } else if (err.type === 'network' || err.type === 'server-error' || err.message.includes('Lost connection')) {
            // THE SERVER KICKED US OUT. Silence the red error.
            // The 'disconnected' event above will handle reconnecting peacefully.
            console.warn("Network notice: micro-disconnection from central server handled in background.");
        } else {
            console.error("P2P Error:", err);
        }
    });
}

function setupConnection(conn) {
    connections.push(conn);

    conn.on('open', () => {
        // 1. Check if I want to follow them, and if so send the request
        const myFriendRecord = friends.find(f => f.id === conn.peer);
        
        // Send follow request ONLY if still pending
        if (myFriendRecord && myFriendRecord.status === 'pending') {
            conn.send({ type: 'follow_request', sender: myUsername });
        }

        // 2. Check if I need to send my photo
        const validPhoto = getValidPhoto();
        if (validPhoto) {
            if (!isPrivate || allowedFollowers.includes(conn.peer)) {
                conn.send({
                    type: 'photo',
                    sender: myUsername,
                    timestamp: Date.now(),
                    image: validPhoto
                });
            }
        }
    });

    conn.on('data', (data) => {
        
        // --- 1. SOMEONE ASKS TO FOLLOW ME ---
        if (data.type === 'follow_request') {
            if (isPrivate) {
                if (!allowedFollowers.includes(data.sender) && !followRequests.includes(data.sender)) {
                    followRequests.push(data.sender);
                    localStorage.setItem('p2p_requests', JSON.stringify(followRequests));
                    renderRequests();
                    showToast(`New friend request from @${data.sender}!`);
                }
                // Reply to their phone: "I'm private, wait in queue"
                conn.send({ type: 'follow_response', status: 'private', sender: myUsername });
            } else {
                if (!allowedFollowers.includes(data.sender)) {
                    allowedFollowers.push(data.sender);
                    localStorage.setItem('p2p_allowed', JSON.stringify(allowedFollowers));
                    renderFollowers();
                }
                // Reply to their phone: "I'm public, accepted immediately"
                conn.send({ type: 'follow_response', status: 'accepted', sender: myUsername });
            }
        }

        // --- 2. RECEIVING RESPONSE TO MY REQUEST ---
        if (data.type === 'follow_response') {
            const friendIndex = friends.findIndex(f => f.id === data.sender);
            if (friendIndex !== -1) {
                if (data.status === 'accepted') {
                    // If public, I'm accepted instantly: remove "Pending"
                    friends[friendIndex].status = 'accepted';
                    localStorage.setItem('p2p_friends', JSON.stringify(friends));
                    renderFriends();
                    showToast(`You are now following @${data.sender}!`);
                } else if (data.status === 'private') {
                    // Label remains, but user is notified
                    showToast(`@${data.sender}'s account is private. Awaiting approval.`);
                }
            }
        }

        // --- 3. PRIVATE FRIEND CLICKS "ACCEPT" ON THEIR SCREEN ---
        if (data.type === 'follow_accepted') {
            const friendIndex = friends.findIndex(f => f.id === data.sender);
            if (friendIndex !== -1) {
                // Finally remove the yellow badge!
                friends[friendIndex].status = 'accepted';
                localStorage.setItem('p2p_friends', JSON.stringify(friends));
                renderFriends();
                showToast(`@${data.sender} accepted your request!`);
            }
        }

        // --- 4. PRIVATE FRIEND CLICKS "DECLINE" ON THEIR SCREEN ---
        if (data.type === 'follow_declined') {
            // Remove the person from our friends list
            friends = friends.filter(f => f.id !== data.sender);
            localStorage.setItem('p2p_friends', JSON.stringify(friends));
            renderFriends();
            showToast(`@${data.sender} declined your request.`);
        }

        // --- 5. HANDLING PHOTO RECEPTION ---
        if (data.type === 'photo') {
            // BUGFIX: Bouncer checks if the request is 'accepted'
            const isFriend = friends.some(f => f.id === data.sender && f.status === 'accepted');
            
            if (!isFriend) {
                console.log(`Photo discarded: you are not authorized or still pending for @${data.sender}.`);
                return; 
            }

            feedData[data.sender] = {
                timestamp: data.timestamp,
                image: data.image
            };
            localStorage.setItem('p2p_feed', JSON.stringify(feedData));
            showToast(`New photo from @${data.sender}!`);
            renderTimeline(); 
        }
    });
}

// --- 2. ADDRESS BOOK MANAGEMENT (FRIENDS) ---
function manualAddFriend() {
    const targetUser = document.getElementById('add-friend-input').value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!targetUser) {
        showToast("Enter a valid username.");
        return;
    }
    if (targetUser === myUsername) {
        showToast("You cannot add yourself.");
        return;
    }

    // Check if friend already exists by finding their .id
    const existingFriend = friends.find(f => f.id === targetUser);
    
    if (!existingFriend) {
        // Save friend AS OBJECT, not as string!
        friends.push({ id: targetUser, status: 'pending' });
        localStorage.setItem('p2p_friends', JSON.stringify(friends));
        
        renderFriends();
        showToast(`@${targetUser} added! Syncing...`);
        document.getElementById('add-friend-input').value = '';
        
        // Attempt immediate connection and listen
        const conn = peer.connect(targetUser);
        setupConnection(conn);
    } else {
        showToast("You already follow this user or are pending.");
    }
}

function removeFriend(username) {
    // Filter strictly using the object's id
    friends = friends.filter(f => f.id !== username);
    localStorage.setItem('p2p_friends', JSON.stringify(friends));
    
    delete feedData[username];
    localStorage.setItem('p2p_feed', JSON.stringify(feedData));
    
    renderFriends();
    renderTimeline();
    showToast(`You are no longer following @${username}.`);
}

function renderFriends() {
    const list = document.getElementById('friends-list');
    
    if (friends.length === 0) {
        list.innerHTML = `<p class="text-sm text-gray-400">You aren't following anyone yet.</p>`;
        return;
    }
    
    list.innerHTML = '';
    
    friends.forEach(friend => {
        const isPending = friend.status === 'pending';
        const badge = isPending ? `<span class="text-[10px] bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full ml-2 font-bold">Pending</span>` : '';
        
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-gray-50 px-4 py-3 rounded-xl border border-gray-100";
        div.innerHTML = `
            <div class="flex items-center">
                <span class="font-semibold text-sm text-gray-800">@${friend.id}</span>
                ${badge}
            </div>
            <button onclick="removeFriend('${friend.id}')" class="text-red-500 hover:text-red-700 text-xs font-bold transition">Remove</button>
        `;
        list.appendChild(div);
    });
}

// --- 3. FEED MANAGEMENT AND SYNC ---
function syncFeed() {
    if (friends.length === 0) return;
    
    // VITAL FIX: If disconnected, try to reconnect BUT STOP HERE
    if (peer.disconnected) {
        showToast("Unstable network. Reconnecting...");
        peer.reconnect();
        return; // <-- THE SECRET IS THIS RETURN. Prevents code from finding friends and crashing the app!
    }

    if (peer.destroyed) {
        showToast("Connection permanently lost. Reload the page.");
        return;
    }

    showToast("Syncing in progress...");
    
    friends.forEach(friend => {
        if (friend && friend.id) {
            const conn = peer.connect(friend.id); 
            setupConnection(conn); 
        }
    });
}

function renderTimeline() {
    const timeline = document.getElementById('timeline');
    timeline.innerHTML = '';

    const users = Object.keys(feedData);

    if (users.length === 0) {
        timeline.innerHTML = `
            <p id="empty-timeline-msg" class="text-center text-gray-400 text-sm py-8 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                No photos received today. Add friends or click Sync!
            </p>`;
        return;
    }

    users.forEach(user => {
        const post = feedData[user];
        const postDiv = document.createElement('div');
        postDiv.className = "bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-col";
        postDiv.innerHTML = `
            <div class="flex items-center mb-3">
                <div class="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex-shrink-0"></div>
                <div class="ml-3">
                    <p class="text-sm font-bold text-gray-900">@${user}</p>
                    <p class="text-xs text-gray-500">Today</p>
                </div>
            </div>
            <img src="${post.image}" class="w-full rounded-lg object-cover" alt="Photo by ${user}">
        `;
        // Always prepend at the top
        timeline.prepend(postDiv);
    });
}

// --- 4. CAMERA / UPLOAD MANAGEMENT (Unchanged) ---
// Set validity seconds here for testing (e.g., 60 seconds)
const PHOTO_LIFETIME_SECONDS = 300; 

function checkDailyPhoto() {
    const savedPhoto = localStorage.getItem('dailyPhoto');
    const savedTimestamp = localStorage.getItem('photoTimestamp'); // New time key
    
    const uploadSection = document.getElementById('upload-section');
    const displaySection = document.getElementById('my-photo-display');
    const myPhotoImg = document.getElementById('my-photo-img');

    let isValid = false;

    if (savedPhoto && savedTimestamp) {
        const now = Date.now(); // Current time in milliseconds
        const timePassedSeconds = (now - parseInt(savedTimestamp, 10)) / 1000;
        
        // If time passed is less than the limit, the photo is valid
        if (timePassedSeconds < PHOTO_LIFETIME_SECONDS) {
            isValid = true;
        }
    }

    if (isValid) {
        // Photo is still valid
        uploadSection.classList.add('hidden');
        displaySection.classList.remove('hidden');
        myPhotoImg.src = savedPhoto;
    } else {
        // Photo expired or doesn't exist: clear memory and show upload
        if (savedPhoto) {
            localStorage.removeItem('dailyPhoto');
            localStorage.removeItem('photoTimestamp');
        }
        uploadSection.classList.remove('hidden');
        displaySection.classList.add('hidden');
    }
}

function getValidPhoto() {
    const savedPhoto = localStorage.getItem('dailyPhoto');
    const savedTimestamp = localStorage.getItem('photoTimestamp');
    
    if (!savedPhoto || !savedTimestamp) return null;
    
    const timePassedSeconds = (Date.now() - parseInt(savedTimestamp, 10)) / 1000;
    if (timePassedSeconds < PHOTO_LIFETIME_SECONDS) {
        return savedPhoto;
    }
    return null;
}

// --- 4. CAMERA / UPLOAD MANAGEMENT WITH COMPRESSION ---
function handlePhotoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    showToast("Compressing photo...");

    const reader = new FileReader();
    reader.onload = (e) => {
        // Create an image in memory
        const img = new Image();
        img.onload = () => {
            // Create a hidden canvas to resize the image
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 800; // Max width for P2P photos
            let width = img.width;
            let height = img.height;

            // Calculate new aspect ratio
            if (width > MAX_WIDTH) {
                height = Math.floor(height * (MAX_WIDTH / width));
                width = MAX_WIDTH;
            }

            canvas.width = width;
            canvas.height = height;

            // Draw the resized image on canvas
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Convert canvas to compressed JPEG (0.7 = 70% quality)
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);

            try {
                // Save the compressed image on the phone
                localStorage.setItem('dailyPhoto', compressedBase64);
                // localStorage.setItem('dailyDate', todayString);
                localStorage.setItem('photoTimestamp', Date.now().toString());

                checkDailyPhoto();
                showToast("Photo saved! Your friends will receive it.");
                
                // Send to currently connected peers
                connections.forEach(conn => {
                    if (conn.open) {
                        conn.send({ type: 'photo', sender: myUsername, date: todayString, image: compressedBase64 });
                    }
                });
            } catch (error) {
                // Catch out-of-memory errors on the phone
                showToast("Save error: storage full or photo too large.");
                console.error(error);
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// --- UTILS ---
let toastTimeout;
function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.opacity = '1';
    
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
    }, 3000);
}


// --- PRIVACY AND REQUESTS MANAGEMENT ---
function togglePrivacy() {
    isPrivate = document.getElementById('privacy-toggle').checked;
    localStorage.setItem('p2p_isPrivate', isPrivate);
    renderRequests();
    
    renderFollowers(); // <-- Added to hide/show list in real-time
    
    showToast(isPrivate ? "Account made Private" : "Account made Public");
}

function acceptRequest(username) {
    // 1. Remove from pending requests
    followRequests = followRequests.filter(u => u !== username);
    localStorage.setItem('p2p_requests', JSON.stringify(followRequests));
    
    // 2. Add to Whitelist
    if (!allowedFollowers.includes(username)) {
        allowedFollowers.push(username);
        localStorage.setItem('p2p_allowed', JSON.stringify(allowedFollowers));
    }
    
    renderRequests();
    renderFollowers();
    showToast(`You accepted @${username}`);

    // 3. Force acceptance NOTIFICATION on network and send photo
    const conn = peer.connect(username);
    conn.on('open', () => {
        // Tell friend to remove yellow "Pending" badge
        conn.send({ type: 'follow_accepted', sender: myUsername });
        
        // If I have a photo, send it immediately!
        const validPhoto = getValidPhoto();
        if (validPhoto) {
            conn.send({ type: 'photo', sender: myUsername, timestamp: Date.now(), image: validPhoto });
        }
    });
}

function declineRequest(username) {
    followRequests = followRequests.filter(u => u !== username);
    localStorage.setItem('p2p_requests', JSON.stringify(followRequests));
    renderRequests();
    
    // Send decline NOTIFICATION to user (removes us from their list)
    const conn = peer.connect(username);
    conn.on('open', () => {
        conn.send({ type: 'follow_declined', sender: myUsername });
    });
}

function renderRequests() {
    const section = document.getElementById('requests-section');
    const list = document.getElementById('requests-list');
    
    // Set initial state of toggle button
    const toggleBtn = document.getElementById('privacy-toggle');
    if (toggleBtn) toggleBtn.checked = isPrivate;

    if (!isPrivate || followRequests.length === 0) {
        section.classList.add('hidden');
        return;
    }

    section.classList.remove('hidden');
    list.innerHTML = '';
    
    followRequests.forEach(req => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-orange-50 px-4 py-3 rounded-xl border border-orange-100";
        div.innerHTML = `
            <span class="font-semibold text-sm text-gray-800">@${req}</span>
            <div class="flex gap-2">
                <button onclick="acceptRequest('${req}')" class="bg-black text-white px-3 py-1 rounded-lg text-xs font-bold transition">Accept</button>
                <button onclick="declineRequest('${req}')" class="text-gray-500 hover:text-red-500 px-2 py-1 text-xs font-bold transition">Decline</button>
            </div>
        `;
        list.appendChild(div);
    });
}

// --- FOLLOWERS MANAGEMENT (WHO FOLLOWS ME) ---
function removeFollower(username) {
    // Remove user from whitelist (won't receive photos anymore)
    allowedFollowers = allowedFollowers.filter(u => u !== username);
    localStorage.setItem('p2p_allowed', JSON.stringify(allowedFollowers));
    
    renderFollowers();
    showToast(`Removed @${username} from your followers.`);
}

function renderFollowers() {
    const section = document.getElementById('allowed-section');
    const list = document.getElementById('followers-list');
    
    // 1. If public account, hide entire section and stop
    if (!isPrivate) {
        if (section) section.classList.add('hidden');
        return;
    }
    
    // 2. If private account, show section
    if (section) section.classList.remove('hidden');
    
    if (allowedFollowers.length === 0) {
        list.innerHTML = `<p class="text-sm text-gray-400">No one is currently authorized to see your photos.</p>`;
        return;
    }
    
    list.innerHTML = '';
    allowedFollowers.forEach(follower => {
        const div = document.createElement('div');
        div.className = "flex justify-between items-center bg-blue-50 px-4 py-3 rounded-xl border border-blue-100";
        div.innerHTML = `
            <span class="font-semibold text-sm text-gray-800">@${follower}</span>
            <button onclick="removeFollower('${follower}')" class="text-red-500 hover:text-red-700 text-xs font-bold transition">Remove</button>
        `;
        list.appendChild(div);
    });
}
