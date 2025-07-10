const express = require('express');
const cors = require('cors');
const XLSX = require('xlsx');
const path = require('path');
const NodeCache = require('node-cache');
const dotenv = require('dotenv');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());


const cache = new NodeCache({
    stdTTL: 3600,
    checkperiod: 600
});


const dataDir = path.join(__dirname, 'data');
const dataFiles = [
    'BoneMarrow.xlsx',
    'Cortex.xlsx',
    'DRG.xlsx',
    'Fat.xlsx',
    'Heart.xlsx',
    'Hypothalamus.xlsx',
    'Kidneys.xlsx',
    'Liver.xlsx',
    'Muscle.xlsx'

];

let geneIndex = {};


async function buildGeneIndex() {
    console.log('Building gene index...');
    const startTime = Date.now();

    geneIndex = {}; 

    try {

        await Promise.all(dataFiles.map(async (file) => {
            const filePath = path.join(dataDir, file);
            const organ = path.basename(file, '.xlsx');

            const workbook = XLSX.readFile(filePath);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json(worksheet);

            jsonData.forEach(row => {
                const geneSymbol = row.Gene_symbol;
                if (!geneSymbol) return;

                if (!geneIndex[geneSymbol]) {
                    geneIndex[geneSymbol] = [];
                }

                geneIndex[geneSymbol].push({
                    organ,
                    ...row
                });
            });
        }));

        console.log(`Gene index built in ${(Date.now() - startTime) / 1000} seconds`);
        console.log(`Found ${Object.keys(geneIndex).length} genes`);
    } catch (error) {
        console.error('Error building gene index:', error);
        process.exit(1);
    }
}

app.get('/', (req, res) => {
    res.send('Hello World');
});

app.get('/api/genes', (req, res) => {
    try {
        const genes = Object.keys(geneIndex).sort();
        res.json(genes);
    } catch (error) {
        console.error('Error getting gene list:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.get('/api/search', (req, res) => {
    try {
        const { gene, page = 1, pageSize = 10 } = req.query;


        if (!gene || typeof gene !== 'string') {
            return res.status(400).json({ error: 'Missing gene parameter' });
        }

        const cacheKey = `search_${gene}_${page}_${pageSize}`;

        const cachedResult = cache.get(cacheKey);
        if (cachedResult) {
            console.log(`Cache hit for gene: ${gene}`);
            return res.json(cachedResult);
        }

        const allResults = geneIndex[gene] || [];
        const total = allResults.length;

        const pageInt = parseInt(page);
        const sizeInt = parseInt(pageSize);
        const start = (pageInt - 1) * sizeInt;
        const paginatedResults = allResults.slice(start, start + sizeInt);

        const response = {
            gene,
            total,
            page: pageInt,
            pageSize: sizeInt,
            totalPages: Math.ceil(total / sizeInt),
            data: paginatedResults.map(item => ({
                organ: item.organ,
                geneSymbol: item.Gene_symbol,
                geneName: item.Gene_name,
                pValue: item.P_value_10_mgkg_vs_control,
                fdr: item.FDR_step_up_10_mgkg_vs_control,
                ratio: item.Ratio_10_mgkg_vs_control,
                foldChange: item.Fold_change_10_mgkg_vs_control,
                lsMeanTreatment: item.LSMean10mgkg_10_mgkg_vs_control,
                lsMeanControl: item.LSMeancontrol_10_mgkg_vs_control
            }))
        };


        cache.set(cacheKey, response);
        res.json(response);

    } catch (error) {
        console.error('Error searching for gene:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


app.post('/api/reindex', async (req, res) => {
    try {
        await buildGeneIndex();
        cache.flushAll(); 
        res.json({ success: true, geneCount: Object.keys(geneIndex).length });
    } catch (error) {
        console.error('Error rebuilding gene index:', error);
        res.status(500).json({ error: 'Error rebuilding gene index' });
    }
});


(async () => {
    try {
        await buildGeneIndex();

        const PORT = process.env.PORT || 3000;
        const server = app.listen(PORT, () => {
            console.log(`
      Server running:
      - Address: http://localhost:${PORT}
      - Gene list: /api/genes
      - Search: /api/search?gene=<gene>
      - Reindex: POST /api/reindex
    `);
        });

        // Keep the process alive
        server.on('error', (error) => {
            console.error('Server error:', error);
        });

    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
})();


process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
});