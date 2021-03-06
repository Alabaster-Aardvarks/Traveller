//controller for all Google API requests
//api guide https://developers.google.com/maps/documentation/javascript/places#place_search_requests
//keyword guide https://developers.google.com/places/supported_types
const axios = require('axios');
const debounce = require('./debounce.js');
const axiosRetry = require('axios-retry');
axiosRetry(axios, { retries: 3 });

//1609 meters = 1 mile
//4827 meters = 3 miles

// debug ====================================================================
const debug = require('debug');
//debug.enable('placesController:*');
const log = debug('placesController:log');
const info = debug('placesController:info');
const error = debug('placesController:error');

const url = 'https://maps.googleapis.com/maps/api/place/nearbysearch/json?&radius=1609';
const radar = 'https://maps.googleapis.com/maps/api/place/radarsearch/json?';
const distance = 'https://maps.googleapis.com/maps/api/distancematrix/json?';

let key;

const setKey = k => {
  key = k;
};

//how to use google places nearby search *unused*
const getData = (place, lat, long) => {
  lat = lat || 37.7825177;
  long = long || -122.4106772;
  return axios({
    method: 'get',
    url: `${url}&type=${place}&location=${lat},${long}&key=${key}`
  })
  .then(response => response.data)
  .catch(error => console.error(error));
};

//how to use google radar search
const getRadarData = (place, lat, long, radius) => {
  return axios({
    method: 'get',
    url: `${radar}location=${lat},${long}&radius=${radius}&type=${place}&key=${key}` // FIXME: distance needs to be sent by client
  })
  .then(response => response.data)
  .catch(error => console.error(error));
};

//converting client mode of transportation query to match google api requirements
const modeKeys = {
  car: 'driving',
  bike: 'cycling',
  walk: 'walking',
  transit: 'transit'
};

//google place detail search *unused*
const getDetailData = (req, res, placeID) =>{
  let placeInfo = {};
  return axios({
    method: 'get',
    url: `https://maps.googleapis.com/maps/api/place/details/json?placeid=${placeID}&key=${key}`
  })
  .then(response => {
    placeInfo = {
      name: response.data.result.name,
      url: response.data.result.url,
    };
    return res.status(200).json(placeInfo);
  })
  .catch(error => console.error(error));
};

// Google distance matrix throttler to avoid rate limiting
const throttledDistanceAPI = debounce.promiseDebounce(axios, 1000, 4);

//google distance matrix api
const getDistanceData = (arrayOfPlaces, lat, long, mode) => {
  let destinationString = 'place_id:';
  for (let i = 0; i < arrayOfPlaces.length; i++) {
    destinationString += arrayOfPlaces[i].id;
    if (i !== arrayOfPlaces.length - 1 ) {
      destinationString += '|place_id:';
    }
  }
  return throttledDistanceAPI({
    method: 'get',
    url: `https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial&origins=${lat},${long}&destinations=${destinationString}&key=${key}&mode=${mode}&departure_time=now`
  })
  .then(response => response.data)
  .catch(error => console.error(error));
};

//google api handler, chains radar and distance matrix results
const getGoogleData = (req, res, keyword) => {
  lat = req.query.lat || 37.7825177;
  long = req.query.long || -122.4106772;
  radius = req.query.radius || 50000;
  mode = modeKeys[req.query.mode] || 'transit';
  date = req.query.date || 'now';
  size = req.query.size || 200; 
  let radarResults = [];
  //grab ids from radar search    
  getRadarData(keyword, lat, long, radius)
  .then(data => {
    if (!data.results.length) {
      console.error(`No google places data found for ${keyword}`);
      return;
    }
    data.results.forEach(place => {
      //radar search gives us place_id, which we use in the distance matrix
      // results array, each array element is a place
      //  [ 
      //   { id: 
      //     place_id:  *we use this in the distance matrix*
      //     reference: 
      //     geometry:{ location:{lat: long:} }  *we grab location as our coordinates*
      //   } 
      //  ]
      radarResults.push({
        id: place.place_id,
        coordinates: place.geometry.location //should we call it location? what does the client want
      });
    }); 
    radarResults = radarResults.splice(0, size);
    return radarResults;
  }) //take radar results and throttle them into distance matrix api
  .then(results => {  
    const divider = 25;
    return Promise.all(
      //break up the radar array into groups of 25, then call api
      [...Array(Math.ceil(results.length / divider))].map((v, index) => {
        const values = results.slice(index * divider, (index + 1) * divider);
        return getDistanceData(values, lat, long, mode)
        .then(data => data);
      })
    )
    .then(dataArray => {
      let finalResults = [];
      // dataArray, each element of dataArray is one of the returned promises
      //  [ 
      //   { 
      //     destination_addresses: [ *array of addresses*] 
      //     origin_address: [ *our origin point, only one element in this array UNNEEDED*] 
      //     rows: [ *there is only one 'row', row[0]*
      //            elements: [   *there is an element which corresponds to each of the destination_addresses*
      //              {
      //               distance: { text: value:}
      //               duration: { text: value:}
      //               fare:{value:}
      //               status:
      //              }
      //            ]
      //           ] 
      //   } 
      //  ]
      let googleStuff = [].concat(...dataArray);
      let index = 0;
      googleStuff.map((distanceResult, distanceResultIndex) => {
        log('distance result ', distanceResult);
        distanceResult.destination_addresses.map((destinationAddress, destinationAddressIndex) => {
          log('destinationaddress ', destinationAddress);
          const element = distanceResult.rows[0].elements[destinationAddressIndex];
          log('element ', element);
          if (element.status !== 'ZERO_RESULTS') {
            finalResults.push({
              'name': destinationAddress,
              // 'time': distanceResult.rows[0].elements[destination_addressIndex].duration.text,
              'time': element.duration.text,
              'location': radarResults[index].coordinates,
              'distance': element.distance.text,
              'metric distance': element.distance.value
            });
            index++;
          }
        });
      });
      log(finalResults);
      log(finalResults.length);
      // client get an an array of the following place objects
      // {
      //   'name': *from destination_addresses 
      //   'time': *duration.text
      //   'location': *finalResults.coordinates
      //   'distance': *distance.text
      //   'metric distance': *distance.value
      // } 
      // distanceResultIndex 0 to 8 (max)
      // chunkIndex 0 to 25 (max)
      // index 0 to 199 (max)
      res.status(200).json(finalResults);
    });
  })
  .catch(error => res.status(500).json({error: 'server error, check request endpoint'}));
};

module.exports = {
  getData, getRadarData, getDistanceData, getGoogleData, getDetailData, setKey
}; 