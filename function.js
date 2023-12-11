const axios = require('axios');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');

// Configuración de claves API y URL de API
const apiKeyMonday = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjIzMjg3MzUyNCwiYWFpIjoxMSwidWlkIjoyMzUzNzM2NCwiaWFkIjoiMjAyMy0wMS0zMVQyMTowMjoxNy4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6OTUwNzUxNiwicmduIjoidXNlMSJ9.lX1RYu90B2JcH0QxITaF8ymd4d6dBes0FJHPI1mzSRE';
const urlApi = 'https://api.sandbox.firmex.cloud/v1/signflow/';

async function generateJWT() {
    try {
        // Lee la clave privada desde la URL
        const privateKeyUrl = 'https://storage.googleapis.com/facturas-urbex/jwt.key';
        
        // Realiza una solicitud HTTP para obtener la clave privada desde la URL
        const response = await axios.get(privateKeyUrl);

        // Obtén el contenido de la clave privada desde la respuesta
        const privateKey = response.data;

        if (!privateKey) {
            throw new Error('La clave privada no está configurada en las variables de entorno.');
        }

        const payload = {
            user: "ecostabal@urbex.cl",
            iss: "gimalaga-user",
            iat: Math.floor(Date.now() / 1000) + (5 * 60)
        };

        return jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    } catch (error) {
        throw new Error('Error al generar el JWT: ' + error.message);
    }
}

// Funciones para interactuar con GoFirmex (crear portafolio, subir documento, etc.)

// Crear portafolio en GoFirmex
async function createPortfolio(tipoContratoColumn, signers) {
    const jwt = await generateJWT();

    try {
        const response = await axios.post(`${urlApi}portfolio`, {
            contract_type: tipoContratoColumn,
            signers: signers
        }, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error creando portafolio en GoFirmex:', error);
        throw error;
    }
}

// Subir documento a GoFirmex
async function uploadDocumentToPortfolio(portfolioId, documentFilePath) {
    const jwt = await generateJWT();

    try {
        const documentBase64 = encodeFileToBase64(documentFilePath);
        const response = await axios.post(`${urlApi}portfolio/${portfolioId}/document`, {
            document: documentBase64,
            document_format: 'pdf'
        }, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error subiendo documento al portafolio en GoFirmex:', error);
        throw error;
    }
}

// Asignar documentos de identidad
async function assignIdentityDocument(portfolioId, signerNin, documentPath, documentDetails) {
    const jwt = await generateJWT();

    try {
        const documentBase64 = encodeFileToBase64(documentPath);
        const response = await axios.post(`${urlApi}portfolio_signer_document`, {
            portfolio_id: portfolioId,
            document: documentBase64,
            signer_nin: signerNin,
            description: documentDetails.description,
            client_document_id: documentDetails.clientDocumentId,
            document_format: 'pdf',
            document_type: documentDetails.documentType,
            document_hash: documentDetails.documentHash
        }, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error asignando documento de identidad en GoFirmex:', error);
        throw error;
    }
}

// Iniciar proceso de firma
async function initiateSigningProcess(portfolioId) {
    const jwt = await generateJWT();

    try {
        const response = await axios.post(`${urlApi}start_portfolio_signing`, {
            portfolio_id: portfolioId
        }, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error iniciando el proceso de firma en GoFirmex:', error);
        throw error;
    }
}

// Función principal para procesar contrato
exports.uploadContract = async (req, res) => {
    try {
        console.log("Inicio de la función");

        // Verificación de la estructura de la solicitud
        if (!req.body || !req.body.event || !req.body.event.pulseId) {
            throw new Error('La solicitud no contiene la estructura esperada de un evento de Monday.com');
        }

        // Obtención de datos de Monday.com
        const itemId = req.body.event.pulseId;
        console.log(`Obteniendo datos de Monday.com para el ítem ${itemId}`);
        const columnsData = await getMondayItemData(itemId);

        // Extracción y manejo de los datos generales del contrato y firmantes
        // Datos generales del contrato
        const tipoContratoColumn = columnsData.find(column => column.id === 'estado_1');
        const ubicacionPropiedadColumn = columnsData.find(column => column.id === 'ubicaci_n');
        const numeroUnidadColumn = columnsData.find(column => column.id === 'texto');
        const archivoContratoColumn = columnsData.find(column => column.id === 'archivo0');

        // Define la variable 'signers' y realiza el mapeo de los datos de los firmantes
        const signers = columnsData.map(data => {
            // Asegúrate de mapear los campos correctamente según tu estructura de datos
            return {
                nin: data.rutFirmanteColumn, // Reemplaza 'rutFirmanteColumn' con el campo correcto
                country: "CL",
                names: data.nombreFirmanteColumn, // Reemplaza 'nombreFirmanteColumn' con el campo correcto
                lastnames: data.apellidoFirmanteColumn, // Reemplaza 'apellidoFirmanteColumn' con el campo correcto
                email: data.correoFirmanteColumn, // Reemplaza 'correoFirmanteColumn' con el campo correcto
                phone: data.telefonoFirmanteColumn, // Reemplaza 'telefonoFirmanteColumn' con el campo correcto
                notification: "none" // O "email" si necesitas enviar notificaciones
            };
        });

        // Creación del portafolio en GoFirmex
        console.log("Creando el portafolio en GoFirmex");
        const portfolioResponse = await createPortfolio(tipoContratoColumn, signers);
        const portfolioId = portfolioResponse.data.portfolio.id;
        console.log(`Portafolio creado en GoFirmex con ID: ${portfolioId}`);
        const filePath = archivoContratoColumn.value; // Reemplaza con la ruta real al archivo
        const documentDetails = {
            description: ubicacionPropiedadColumn.text + numeroUnidadColumn.text,
            clientDocumentId: tipoContratoColumn.text, // Reemplaza con el valor correcto
            documentType: tipoContratoColumn.text, // Reemplaza con el valor correcto
            documentHash: "Hash del Documento" // Calcula o define este valor según sea necesario
        };

        // Subir un documento a GoFirmex
        console.log("Subiendo documento a GoFirmex");
        await uploadDocumentToPortfolio(portfolioId, filePath);

        // Asignación de documentos de identidad y creación de documento en el portafolio
        console.log("Asignando documentos de identidad");
        const filePathVerso = path.join(__dirname, 'archivos', 'versoCedula.pdf'); // Reemplaza con la ruta real al archivo
        const filePathReverso = path.join(__dirname, 'archivos', 'reversoCedula.pdf'); // Reemplaza con la ruta real al archivo
        const fileDominioVigente = path.join(__dirname, 'archivos', 'dominioVigente.pdf'); // Reemplaza con la ruta real al archivo

        await assignIdentityDocument(portfolioId, signers[0].nin, filePathVerso, documentDetails);
        await assignIdentityDocument(portfolioId, signers[0].nin, filePathReverso, documentDetails);
        await assignIdentityDocument(portfolioId, signers[0].nin, fileDominioVigente, documentDetails);

        // Iniciar el proceso de firma
        console.log("Iniciando el proceso de firma");
        const signingResponse = await initiateSigningProcess(portfolioId);

        console.log("Item procesado correctamente");
        res.status(200).send("Item procesado correctamente");
    } catch (error) {
        console.error("Error en la función:", error.message);
        res.status(500).send("Error procesando el evento de Monday.com");
    }
};

async function getMondayItemData(itemId) {
    const query = `query { items(ids: [${itemId}]) { column_values { id type value text } } }`;

    const response = await axios.post('https://api.monday.com/v2', {
        query: query
    }, {
        headers: {
            'Authorization': `Bearer ${apiKeyMonday}`,
            'Content-Type': 'application/json'
        }
    });

    return response.data.data.items[0].column_values;
}

function encodeFileToBase64(filePath) {
    return fs.readFileSync(filePath, { encoding: 'base64' });
}
