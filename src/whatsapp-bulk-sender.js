const axios = require("axios");
const { log } = require("console");
const fs = require("fs").promises;
const path = require("path");

class WhatsappBulkSender {
    constructor(config) {
        this.phoneNumberId = config.phoneNumberId;
        this.accessToken = config.accessToken;
        this.apiVersion = config.apiVersion || 'v22.0';
        this.baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

        // control del rate limit
        this.maxMessagesPerSecond = 80;
        this.messageDelay = 1000 / this.maxMessagesPerSecond;

        // estadisticas
        this.stats = {
            total: 0,
            sent: 0,
            failed: 0,
            errors: []
        };
    }

    /**
     * Construye un componente de botones compatible con templates a partir de una lista simple.
     * @param buttons Array de botones: [{ title: 'Aceptar' }, ...]
     * @returns {object|null} componente para inyectar en payload.template.components o null si no aplica
     */
    buildButtonComponent(buttons) {
        if (!Array.isArray(buttons) || buttons.length === 0) return null;

        // Mapear a estructura simple que intentamos usar en templates
        const mapped = buttons.map((b, idx) => ({
            type: 'reply',
            reply: {
                id: `btn_${idx}`,
                title: b.title || `Button ${idx + 1}`
            }
        }));

        return {
            type: 'button',
            buttons: mapped
        };
    }

    /**
     * Envia un mensaje a un destinatario individual
     * @param to numero de celular al que va a ir dirigido
     * @param templateName nombre del template de marketing que meta ya debio haber aceptado
     * @param templateParams parametros del template
     * @param languageCode codigo de idioma
     * @returns {Promise<void>}
     */
    async sendMessage(to, templateName, templateParams = [], languageCode = 'en_US', buttons = []) {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to: this.formatPhoneNumber(to),
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: languageCode },
                    components: []
                }
            };

            this.addHeaderParams(templateParams, payload);
            this.addBodyParams(templateParams, payload);

            // Agregar componente de botones si se proporcionan (desacoplado a método)
            const buttonComponent = this.buildButtonComponent(buttons);
            if (buttonComponent) {
                payload.template.components = payload.template.components || [];
                payload.template.components.push(buttonComponent);
            }

            console.log('Payload => ', JSON.stringify(payload, null, 2));
            const response = await axios.post(this.baseUrl, payload, {
                headers: {
                    'Authorization': `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                success: true,
                messageId: response.data?.messages[0].id,
                to: to
            };
        } catch (error) {
            return {
                success: false,
                to: to,
                error: error.response?.data || error.message
            };
        }
    }

    /**
     * function handle add header params
     * @param {*} templateParams 
     * @param {*} payload 
     */
    addHeaderParams(templateParams, payload) {
        if (templateParams.length > 0) {
            const parameters = templateParams
            .filter(param => param.typeTemplate === "header")
            .map(param => {
                return {
                    type: param.type,
                    document: param.document
                }
            });
            payload.template.components.push(
                {
                    type: "header",
                    parameters: parameters
                }
            );
        }
    }

    /**
     * function handle add body params
     * 
     * @param {*} templateParams 
     * @param {*} payload 
     */
    addBodyParams(templateParams, payload) {
        // Solo agregar components si hay variables
        if (templateParams.length > 0) {
            const parameters = templateParams
            .filter(param => param.typeTemplate === "body")
            .map(param => {
                if (typeof param === 'string') {
                    return { type: param.type, text: param.paramValue, parameter_name: param.paramName };
                }
                return { type: param.type, text: String(param.paramValue), parameter_name: param.paramName };
            });

            payload.template.components.push(
                {
                    type: 'body',
                    parameters: parameters
                }
            );
        }
    }


    /**
     * funcion encargada de hacer la limpieza del numero y verificar que tenga el codigo de colombia
     * @param phone phone number to be cleaned
     * @returns {*} phone number cleaned
     */
    formatPhoneNumber(phone) {
        // limpiar phone
        let cleaned = String(phone).replace(/[\s\-+()]/g, '');

        // Si ya tiene el código de país '57', devolver tal cual
        if (cleaned.startsWith('57')) {
            return cleaned;
        }

        // Si es un celular colombiano sin código (10 dígitos y comienza con 3), anteponer '57'
        if (cleaned.length === 10 && cleaned[0] === '3') {
            return '57' + cleaned;
        }

        // Para cualquier otro caso, devolver el valor limpio (sin signos)
        return cleaned;
    }

    /**
     * Valida y formatea un numero de celular colombiano
     * @param phone numero de telefono a validar
     * @returns {string|false} numero formateado o false si invalido
     */
    validateAndFormatPhone(phone) {
        if (!phone || typeof phone !== 'string' || phone.trim() === '') return false;

        let cleaned = phone.replace(/[\s\-+()]/g, '');

        if (cleaned.startsWith('57') && cleaned.length === 12 && cleaned[2] === '3') {
            return cleaned;
        } else if (!cleaned.startsWith('57') && cleaned.length === 10 && cleaned[0] === '3') {
            return '57' + cleaned;
        }

        return false;
    }

    async sendBulkMessages(recipients, templateName, getTemplateParams, buttons = []) {
        this.stats.total = recipients.length;
        console.log(`📩 Iniciando env�o masivo a ${this.stats.total} destinatarios...`)
        console.log(`⏱️  Tiempo estimado: ${Math.ceil(this.stats.total / this.maxMessagesPerSecond / 60)} minutos\n`);

        let results = [];
        const batchSize = 50; // processing in lotes for best handle

        for (let i = 0; i < recipients.length; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);
            const batchPromise = batch.map(async (recipient, index) => {
                // delay progresivo para respetar reate limiting
                await this.sleep((i + index) * this.messageDelay);

                const params = getTemplateParams ? getTemplateParams(recipient) : [];
                const result = await this.sendMessage(
                    recipient.phone,
                    templateName,
                    params,
                    'es_CO',
                    buttons
                );

                if (result?.success) {
                    this.stats.sent++;
                    console.log(`✅ [${this.stats.sent}/${this.stats.total}] Enviado a ${recipient.phone}`);
                } else {
                    this.stats.failed++;
                    this.stats.errors.push(
                        {
                            phone: recipient.phone,
                            error: result.error
                        }
                    );
                    console.log(`❌ [${this.stats.total - this.stats.failed}/${this.stats.total}] Error en ${recipient.phone}`);
                }
                return result;
            });
            const batchResults = await Promise.all(batchPromise);
            results.push(...batchResults);

            if (i + batchSize < recipients.length)
                await this.sleep(1000);
        }
        return results;
    }

    /**
     * function to load recipients from a csv file
     * @param filePath
     * @returns {Promise<*[]>}
     */
    async loadRecipientsFromCSV(filePath) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n').filter(line => line.trim());

            const headers = lines[0].split(',').map(h => h.trim());
            const telefonoIndex = headers.indexOf('TELEFONO');

            if (telefonoIndex === -1) {
                console.error('Error: Columna TELEFONO no encontrada en el CSV');
                return [];
            }

            const recipients = [];

            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim());
                if (values.length > telefonoIndex) {
                    const phoneValue = values[telefonoIndex];
                    const formattedPhone = this.validateAndFormatPhone(phoneValue);
                    if (formattedPhone) {
                        recipients.push({ phone: formattedPhone });
                    }
                }
            }
            console.log(`📋 Cargados ${recipients.length} destinatarios válidos desde ${filePath}`);
            return recipients;
        } catch (error) {
            console.error(`Error al cargar destinatarios desde ${filePath}:`, error);
            return [];
        }
    }

    async saveReport(results, outputPath = './report.json') {
        const report = {
            timestamp: new Date().toISOString(),
            stats: this.stats,
            details: results
        };
        await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
        console.log(`\n📊 Reporte guardado en: ${outputPath}`);
        return report;
    }

    showSummary() {
        console.log('\n' + '='.repeat(50));
        console.log('📊 RESUMEN DE ENVÍO');
        console.log('='.repeat(50));
        console.log(`Total de mensajes: ${this.stats.total}`);
        console.log(`✅ Enviados exitosamente: ${this.stats.sent} (${((this.stats.sent / this.stats.total) * 100).toFixed(2)}%)`);
        console.log(`❌ Fallidos: ${this.stats.failed} (${((this.stats.failed / this.stats.total) * 100).toFixed(2)}%)`);
        console.log('='.repeat(50) + '\n');

        if (this.stats.errors.length > 0) {
            console.log('❌ ERRORES DETALLADOS:');
            this.stats.errors.slice(0, 10).forEach(err => {
                console.log(`  - ${err.phone}: ${JSON.stringify(err.error).substring(0, 200)}`);
            });
            if (this.stats.errors.length > 10) {
                console.log(`  ... y ${this.stats.errors.length - 10} errores más`);
            }
        }
    }

    /**
     * funcion auxiliar de delay
     * @param ms
     * @returns {Promise<unknown>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * funcion auxiliar de validacion de la conexion con la api
     * @returns {Promise<boolean>}
     */
    async validateConnection() {
        try {
            const response = await axios.get(
                `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                }
            );
            console.log('✅ Conexión exitosa con la API');
            return true;
        } catch (error) {
            console.error('❌ Error de conexión con la API:', error.response?.data || error.message);
            return false;
        }
    }
}

module.exports = WhatsappBulkSender;