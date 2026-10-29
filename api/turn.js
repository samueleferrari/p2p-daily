// export default async function handler(req, res) {
//     // La chiave segreta viene letta dalle impostazioni di Vercel, mai dal codice visibile!
//     const apiKey = process.env.METERED_API_KEY;
//
//     // Inserisci qui l'URL base che ti ha dato Metered (es. tuo-nome.metered.ca)
//     const meteredDomain = "p2pdaily.metered.live"; 
//
//     try {
//         // Il server di Vercel chiede a Metered le credenziali ICE temporanee
//         const response = await fetch(`https://${meteredDomain}/api/v1/turn/credentials?apiKey=${apiKey}`);
//         const iceServers = await response.json();
//
//         // Risponde al tuo frontend consegnando la lista dei server pronti all'uso
//         res.status(200).json(iceServers);
//     } catch (error) {
//         console.error(error);
//         res.status(500).json({ error: "Errore nel recupero delle credenziali TURN" });
//     }
// }
//
//
export default async function handler(req, res) {
    // Leggiamo le chiavi dalle impostazioni di Vercel
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
        return res.status(500).json({ error: "Credenziali Twilio mancanti" });
    }

    try {
        // Creiamo la stringa di autenticazione richiesta da Twilio
        const authString = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

        // Chiamiamo l'API di Twilio per ottenere i server (token valido per 24 ore)
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Tokens.json`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${authString}`
            }
        });

        const data = await response.json();
        
        // Twilio ci restituisce un array chiamato "ice_servers". Lo passiamo al frontend.
        res.status(200).json(data.ice_servers);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Errore nel recupero delle credenziali Twilio" });
    }
}
