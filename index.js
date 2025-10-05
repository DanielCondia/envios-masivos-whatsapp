require('dotenv').config();

const WhatsappBulkSender = require('./src/whatsapp-bulk-sender.js');

const config = {
    phoneNumberId: process.env.PHONE_NUMBER_ID,
    accessToken: process.env.ACCESS_TOKEN,
    apiVersion: process.env.API_VERSION || 'v22.0'
};

const sender = new WhatsappBulkSender(config);

// Example usage
async function main() {
    // Validate connection
    const isConnected = await sender.validateConnection();
    if (!isConnected) {
        console.log('Connection failed. Check your credentials.');
        return;
    }

    // Example: Load recipients from CSV (assuming a file exists)
    // const recipients = await sender.loadRecipientsFromCSV('./recipients.csv');
    // Then send bulk
    // const results = await sender.sendBulkMessages(recipients, 'template_name', (recipient) => [recipient.name]);
    // sender.saveReport(results);
    // sender.showSummary();

    console.log('Main file ready. Uncomment example code to test.');
}

main().catch(console.error);