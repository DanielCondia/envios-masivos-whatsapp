require('dotenv').config();

const WhatsappBulkSender = require('./src/whatsapp-bulk-sender.js');
const PATH_CSV = './data/test_phone_numbers.csv';

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

    const recipients = await sender.loadRecipientsFromCSV(PATH_CSV);
    // console.log('recipients => ', recipients);

    // Configura aquí el número de variables que tiene tu plantilla:
    const NUM_TEMPLATE_VARIABLES = 1; // Ahora la plantilla tiene 2 variables: la original y customer_name
    const CONTENT_BUTTONS = false;

    // Función dinámica para los parámetros del template
    const getTemplateParams = (recipient) => {
        if (NUM_TEMPLATE_VARIABLES === 0) return [];
        // Retornamos un array con exactamente NUM_TEMPLATE_VARIABLES items.
        // Enviamos ambos parámetros como strings posicionales en el orden esperado por la plantilla.
        return ['{{customer_name}}'];
    };

    // Botones de ejemplo (se enviarán a todos los destinatarios)
    const buttons = null;
    if (CONTENT_BUTTONS) {
        buttons = [
            { title: 'Aceptar' },
            { title: 'Rechazar' }
        ];
    }

    // Then send bulk
    const results = await sender.sendBulkMessages(recipients, 'prueba_plantilla_mensajes', getTemplateParams, buttons);
    await sender.saveReport(results);
    sender.showSummary();

    console.log('Main file ready. Uncomment example code to test.');
}

main().catch(console.error);