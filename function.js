const axios = require('axios');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

// Configuración de claves API y URL de API
const apiKeyMonday = 'eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjIzMjg3MzUyNCwiYWFpIjoxMSwidWlkIjoyMzUzNzM2NCwiaWFkIjoiMjAyMy0wMS0zMVQyMTowMjoxNy4wMDBaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6OTUwNzUxNiwicmduIjoidXNlMSJ9.lX1RYu90B2JcH0QxITaF8ymd4d6dBes0FJHPI1mzSRE';
const urlApi = 'https://api.sandbox.firmex.cloud/v1/signflow/';

async function generateJWT() {
    try {
      const secretName = 'projects/1096874551601/secrets/jwt-gofirmex/versions/1'; // Reemplaza con el nombre de tu secreto
      const client = new SecretManagerServiceClient();
      const [version] = await client.accessSecretVersion({ name: secretName });
  
      const privateKey = version.payload.data.toString('utf8');
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

  async function getMondayItemData(itemId) {
    const query = `query { items(ids: [${itemId}]) { column_values { id type value text } } }`;

    const response = await axios.post('https://api.monday.com/v2', {
        query: query
    }, {
        headers: {
            'Authorization': `Bearer ${apiKeyMonday}`, // Aquí se agrega la clave de API
            'Content-Type': 'application/json'
        }
    });

    return response.data.data.items[0].column_values;
}


// Funciones para interactuar con GoFirmex (crear portafolio, subir documento, etc.)

// Crear portafolio en GoFirmex
async function createPortfolio(portfolioType, signers, clientPortfolioId = '') {
    const jwt = await generateJWT(); // Espera a que se genere el JWT

    // Mapeo de selecciones de Monday.com a IDs de GoFirmex
    const portfolioIds = {
        'Arrendamiento': '58663eb1-9fe3-4ecd-8662-b405366954d2', // Contrato de Arriendo
        'Mandato': '2d036dd8-81ed-4c71-89cf-056533032cd2' // Mandato de Administración de Arriendo
    };

    const portfolioId = portfolioIds[portfolioType]; // Obtén el ID correcto según la selección
    
    try {
        const response = await axios.post(`${urlApi}portfolio`, {
            portfolio_type: portfolioId,
            signers: signers, // Debes estructurar esta variable siguiendo el formato necesario
            client_portfolio_id: clientPortfolioId // Opcional, puede ser un string vacío
        }, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data; // Asume que la respuesta incluye los detalles del portafolio creado
    } catch (error) {
        console.error('Error creando el portafolio en GoFirmex:', error);
        throw error;
    }
}

// Crear documento
function encodeFileToBase64(filePath) {
    return fs.readFileSync(filePath, { encoding: 'base64' });
}

async function createDocumentInPortfolio(portfolioId, filePath, documentDetails) {
    const jwt = generateJWT();
    const documentBase64 = encodeFileToBase64(filePath);

    try {
        const response = await axios.post(`${urlApi}portfolio_document`, {
            portfolio_id: portfolioId,
            document: documentBase64,
            description: documentDetails.description,
            client_document_id: documentDetails.clientDocumentId,
            document_type: documentDetails.documentType,
            sign: documentDetails.sign,
            notary_sign: documentDetails.notarySign,
            document_format: 'pdf',
            document_hash: documentDetails.documentHash
        }, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error creando documento en portafolio:', error);
        throw error;
    }
}

// Subir documento a GoFirmex
async function uploadDocumentToPortfolio(portfolioId, documentFilePath) {
    const jwt = generateJWT();
    const formData = new FormData();
    formData.append('file', fs.createReadStream(documentFilePath));

    try {
        const response = await axios.post(`${urlApi}portfolio/${portfolioId}/document`, formData, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'multipart/form-data'
            }
        });

        return response.data;
    } catch (error) {
        console.error('Error subiendo documento al portafolio:', error);
        throw error;
    }
}

// Asignar documentos de identidad
async function assignIdentityDocument(portfolioId, signerNin, documentPath, documentDetails) {
    const jwt = await generateJWT(); // Espera a que se genere el JWT
    const documentBase64 = encodeFileToBase64(documentPath);

    try {
        const response = await axios.post(`${urlApi}portfolio_signer_document`, {
            portfolio_id: portfolioId,
            document: documentBase64,
            description: documentDetails.description,
            signer_nin: signerNin, // Reemplaza 'signerNin' con el valor correcto
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
        console.error('Error al asignar el documento de identidad:', error);
        throw new Error('Error al asignar el documento de identidad: ' + error.message);
    }
}

// Iniciar proceso de firma
async function initiateSigningProcess(portfolioId) {
    const jwt = generateJWT();

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
        console.error('Error iniciando el proceso de firma:', error);
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

        // Datos de cada firmante
        const nombreFirmanteColumn = columnsData.find(column => column.id === 'reflejo0');
        const apellidoFirmanteColumn = columnsData.find(column => column.id === 'reflejo');
        const rutFirmanteColumn = columnsData.find(column => column.id === 'reflejo_1');
        const telefonoFirmanteColumn = columnsData.find(column => column.id === 'reflejo_2');
        const correoFirmanteColumn = columnsData.find(column => column.id === 'reflejo_3');

        // Extracción de datos de documentos de identidad de monday.com
        const dominioVigente = columnsData.find(column => column.id === 'archivo');
        const versoCedula = columnsData.find(column => column.id === 'reflejo_12');
        const reversoCedula = columnsData.find(column => column.id === 'reflejo_14');
        
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
        
        // Creación del portafolio en GoFirmex y manejo de respuesta
        console.log("Creando el portafolio en GoFirmex");
        const portfolioResponse = await createPortfolio(tipoContratoColumn, signers);
        const portfolioId = portfolioResponse.data.portfolio.id;
        console.log(`Portafolio creado en GoFirmex con ID: ${portfolioId}`);
        const filePath = '/ruta/al/documento.pdf'; // Reemplaza con la ruta real al archivo
        const documentDetails = {
            description: ubicacionPropiedadColumn + numeroUnidadColumn,
            clientDocumentId: nin,
            documentType: tipoContratoColumn,
            sign: true,
            notarySign: true,
            documentHash: "Hash del Documento" // Calcula o define este valor según sea necesario
        };

       // Subir un documento a GoFirmex
       console.log("Subiendo documento a GoFirmex");
       const documentFilePath = archivoContratoColumn; // Reemplaza con la ruta real al archivo
       await uploadDocumentToPortfolio(portfolioId, documentFilePath);

        // Asignación de documentos de identidad y creación de documento en el portafolio
        console.log("Asignando documentos de identidad");
        await assignIdentityDocument(portfolioId, signerNin, filePathVerso, documentDetails);
        await assignIdentityDocument(portfolioId, signerNin, filePathReverso, documentDetails);
        await assignIdentityDocument(portfolioId, signerNin, fileDominioVigente, documentDetails);

        // Asignar documentos de identidad
        const filePathVerso = path.join(__dirname, 'archivos', versoCedula);
        const filePathReverso = path.join(__dirname, 'archivos', reversoCedula);
        const fileDominioVigente = path.join(__dirname, 'archivos', dominioVigente);

        console.log("Creando documento en el portafolio");
        const documentResponse = await createDocumentInPortfolio(portfolioId, filePath, documentDetails);
        console.log(`Documento creado en el portafolio con ID: ${documentResponse.documentId}`);

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
