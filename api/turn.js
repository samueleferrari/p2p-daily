export default async function handler(req, res) {
    // Read keys from Vercel environment variables
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        return res.status(500).json({ error: "Missing Twilio credentials" });
    }

    try {
        // Create the authentication string required by Twilio
        const authString = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        // Call the Twilio API to get the servers (token valid for 24 hours)
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authString}`
            }
        });

        const data = await response.json();
        
        // Twilio returns an array called "ice_servers". We pass it to the frontend.
        res.status(200).json(data.ice_servers);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Error retrieving Twilio credentials" });
    }
}
