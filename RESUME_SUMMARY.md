# GenoCorr Platform - Resume Summary

## Project Description (For Resume)

**GenoCorr Platform** is a comprehensive web-based bioinformatics platform for gene expression analysis, ontology enrichment, and correlation pattern discovery across multiple tissues and experimental conditions. This full-stack web application was built using FastAPI (Python) and Next.js (React/TypeScript) to provide researchers with powerful genomic data analysis capabilities.

The platform successfully integrates nine tissue-specific gene expression datasets with MongoDB for efficient querying and cross-tissue analysis, enabling researchers to search and compare gene expression patterns across Bone Marrow, Cortex, DRG, Fat, Heart, Hypothalamus, Kidneys, Liver, and Muscle tissues. The implementation includes Gene Ontology (GO) enrichment analysis with customizable theme-based pathways using the GProfiler API, allowing researchers to perform targeted functional analysis beyond standard GO enrichment.

A significant achievement was the successful conversion of the MATLAB-based IVCCA (Inter-Variability Cross Correlation Analysis) application to Python, maintaining algorithm fidelity while improving performance and web integration. This conversion enabled the development of a comprehensive correlation analysis suite supporting Pearson, Spearman, and Kendall correlation methods with detailed statistical summaries. The platform implements clustering analysis using both K-Means and Hierarchical methods, with optimal cluster detection through Elbow and Silhouette methods, enabling researchers to identify meaningful gene expression patterns.

The dimensionality reduction features include Principal Component Analysis (PCA) with explained variance calculation and t-Distributed Stochastic Neighbor Embedding (t-SNE) for non-linear dimensionality reduction, both with customizable parameters. A pathway analysis module was created for single-pathway correlation pattern analysis and multi-pathway comparison using cosine similarity metrics. The platform also includes a two-dataset correlation analysis tool designed for comparative analysis between different experimental conditions, providing advanced sorting and filtering capabilities.

The visualization engine produces publication-ready high-resolution heatmaps, dendrograms, histograms, and scatter plots, eliminating the need for additional visualization tools. The RESTful API architecture features automatic OpenAPI documentation generation, type safety through Pydantic models, and comprehensive error handling, ensuring reliability and ease of integration. Performance optimization was achieved through NumPy vectorization and asynchronous request handling, enabling efficient processing of large-scale datasets.

The technical stack includes FastAPI, Python, MongoDB, pandas, NumPy, SciPy, scikit-learn, matplotlib, seaborn, and GProfiler on the backend, with Next.js 15, React, and TypeScript on the frontend. The platform integrates advanced statistical correlation methods, clustering algorithms, dimensionality reduction techniques, and pathway analysis capabilities.

The platform addresses several critical challenges in genomics research. It eliminates accessibility barriers by providing a web-based interface instead of command-line tools, making advanced bioinformatics analysis accessible to researchers without extensive computational expertise. The system unifies scattered gene expression data across multiple files into an integrated database, enabling seamless cross-tissue comparisons. Multiple analysis workflows including correlation, clustering, and pathway enrichment are integrated into a single platform, streamlining research processes. The platform enables customizable theme-based analysis beyond standard GO enrichment, provides publication-ready visualization without requiring additional tools, and features a cloud-ready architecture designed for scalable deployment and concurrent users.

---

## Short Version (For Brief Resume Entries)

**GenoCorr Platform** is a full-stack web application built with FastAPI and Next.js for comprehensive genomic data analysis. The platform features multi-tissue gene expression search across nine tissue types, GO enrichment analysis with customizable theme-based pathways, correlation matrix computation supporting Pearson, Spearman, and Kendall methods, clustering analysis using K-Means and Hierarchical methods, dimensionality reduction through PCA and t-SNE, pathway analysis with single and multi-pathway comparison capabilities, and publication-ready visualizations. A key achievement was the successful conversion of a MATLAB-based IVCCA application to Python, maintaining algorithm fidelity while improving performance and web integration.

---

## One-Line Version (For Very Brief Descriptions)

**GenoCorr Platform** - Full-stack bioinformatics web platform (FastAPI/Python + Next.js/React) for multi-tissue gene expression analysis, GO enrichment, correlation analysis, clustering, dimensionality reduction, and pathway comparison with publication-ready visualizations.
