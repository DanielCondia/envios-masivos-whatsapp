const axios = require("axios");
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
     * Envia un mensaje a un destinatario individual
     * @param to numero de celular al que va a ir dirigido
     * @param templateName nombre del template de marketing que meta ya debio haber aceptado
     * @param templateParams parametros del template
     * @param languageCode codigo de idioma
     * @returns {Promise<void>}
     */
    async sendMessage(to, templateName, templateParams = [], languageCode = 'es') {
        try {
            const payload = {
                messaging_product: 'whatsapp',
                to: this.formatPhoneNumber(to),
                type: 'template',
                template: {
                    name: templateName,
                    language: {code: languageCode},
                    components: []
                }
            };

            // Agregar parametros si existen
            if (templateParams.length > 0) {
                payload.template.components.push({
                    type: 'body',
                    parameters: templateParams.map(param => ({
                        type: 'text',
                        text: param
                    }))
                });
            }

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
     * funcion encargada de hacer la limpieza del numero y verificar que tenga el codigo de colombia
     * @param phone phone number to be cleaned
     * @returns {*} phone number cleaned
     */
    formatPhoneNumber(phone) {
        // limpiar phone
        let cleaned = phone.replace(/[\s\-+()]/g, '');

        // si no tiene codigo de pais, agregar el de colombia +57 by default
        if ((!cleaned.startsWith('57') || !cleaned.startsWith('+57')) || cleaned.length === 10)
            cleaned = '57' + cleaned;
        return cleaned;
    }

    async sendBulkMessages(recipients, templateName, getTemplateParams) {
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
                    params
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
            const recipients = [];

            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(v => v.trim());
                const recipient = {};

                headers.forEach((header, index) => {
                    recipient[header] = values[index];
                });
                recipients.push(recipient);
            }
            console.log(`📋 Cargados ${recipients.length} destinatarios desde ${filePath}`);
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
        console.log(`✅ Enviados exitosamente: ${this.stats.sent} (${((this.stats.sent/this.stats.total)*100).toFixed(2)}%)`);
        console.log(`❌ Fallidos: ${this.stats.failed} (${((this.stats.failed/this.stats.total)*100).toFixed(2)}%)`);
        console.log('='.repeat(50) + '\n');

        if (this.stats.errors.length > 0) {
            console.log('❌ ERRORES DETALLADOS:');
            this.stats.errors.slice(0, 10).forEach(err => {
                console.log(`  - ${err.phone}: ${JSON.stringify(err.error).substring(0, 100)}`);
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
                this.baseUrl,
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