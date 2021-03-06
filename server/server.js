//for API keys - create a .env file for google API in dev environments
require('dotenv').config({ silent: true, path: './traveller/.env' });
//middleware
const express = require('express');
const morgan = require('morgan');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const placesRouter = require('./router/placesRouter');
const hereRouter = require('./router/hereRouter');
const navitiaRouter = require('./router/navitiaRouter');

// debug ====================================================================
const debug = require('debug');
//debug.enable('server:*');
const log = debug('server:log');
const info = debug('server:info');
const error = debug('server:error');

const app = express();

placesRouter.setKey(process.env.GOOGLE_KEY);
navitiaRouter.setKey(process.env.NAVITIA_TOKEN);
hereRouter.setKey(process.env.HERE_APP_CODE, process.env.HERE_APP_ID);

// Don't enable CORS in production.
if (/^(dev|test)$/.test(process.env.NODE_ENV)) {
  app.use(cors());
}

if (process.env.NODE_ENV !== 'test') {
  // Don't log requests during testing
  app.use(morgan('dev'));
}

app.use(bodyParser.json());

// /api should be the home for all of our API endpoints
app.use('/places', placesRouter);
app.use('/navitia', navitiaRouter);
app.use('/here', hereRouter);
// 404 all other routes
app.use('*', (req, res) => {
  res.status(404).send({error: 'endpoint not found'});
});
              //dev env          //test & production env
const port = process.env.PORT || 3000;

app.listen(port);

console.log(`Server listening on port: ${port}`);
module.exports = app;
