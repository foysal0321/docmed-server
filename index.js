const express = require('express');
const cors = require('cors');
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

require('dotenv').config();
const jwt = require('jsonwebtoken');
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const nodemailer = require("nodemailer");


//middle ware
const app= express();
app.use(express.json())
app.use(cors());

//mongoDB
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.pbaqirc.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

//verify jwt token
function verifyJwt (req,res, next){
    const authrazation = req.headers.authrazation;
    if(!authrazation){
        return res.status(401).send('unauthrazation acess')
    }
    const token = authrazation.split(' ')[1]
    jwt.verify(token, process.env.ACESS_TOKEN, function(err,decoded){
        if(err){
          return  res.status(401).send({message: 'forbian acess'})
        }
        req.decoded = decoded;
        next()
    })
}

  function sendBookingEmail(booking){
    const {email, appoimentDate, treatment,slot} = booking
    let transporter = nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
            user: "apikey",
            pass: process.env.SENDGRID_API_KEY
        }
    })

    transporter.sendMail({
        from: "SENDER_EMAIL", // verified sender email
        to: email, // recipient email
        subject: `your apporment for ${treatment} is confirmed`, // Subject line
        text: "Hello world!", // plain text body
        html: `
        <h3>Your appoment is confirmed</h3>
        <div>
        <p>your apporment is ${treatment}</p>
        <p>Please visit on ${appoimentDate}on at ${slot} ${treatment}</p>
        <h5>Thanks for Doctal Protal!</h5>
        </div>
        
        `, // html body
      }, function(error, info){
        if (error) {
          console.log(error);
        } else {
          console.log('Email sent: ' + info.response);
        }
      });
  }

async function run (){
    try{
        const appoimentOption = client.db('doctorsProtal').collection('appoimentOptions');
        const bookingColletion = client.db('doctorsProtal').collection('bookings')
        const usersColletion = client.db('doctorsProtal').collection('users')
        const doctorColletion = client.db('doctorsProtal').collection('doctors')
        const paymentColletion = client.db('doctorsProtal').collection('payments')

        //verfy admin
        const  verifyAdmin = async (req,res, next)=>{
            //console.log(req.decoded.email);
            const decodedEmail = req.decoded.email;
            const query = {email: decodedEmail};
            const user = await usersColletion.findOne(query);
            if(user?.role !== 'admin'){
                res.status(403).send({message: 'forbian acess'})
            }
            next()
        }
       
        app.get('/options', async (req,res)=>{
            const date = req.query.date;  
            const query ={};
            const options = await appoimentOption.find(query).toArray();

            const bookingQuery = {appoimentDate: date};
            const alreadybook = await bookingColletion.find(bookingQuery).toArray();
            options.forEach(option =>{
                const rebook = alreadybook.filter(book=> book.
                treatment === option.name)
                const bookslot = rebook.map(b => b.slot)
                const remineSlots = option.slots.filter(slot => !bookslot.includes(slot))
                option.slots = remineSlots
                // console.log(bookslot);                
            })
            res.send(options)
        })

        app.get('/bookings', verifyJwt, async (req,res)=>{
            const email = req.query.email;
            const decodeemail = req.decoded.email 
            if( email !== decodeemail){
                return res.status(401).send({message: 'frbian acess'})
            }
            const query = { email: email }
            const bookings = await bookingColletion.find(query).toArray();
            res.send(bookings)
        })

        app.post('/bookings', async (req,res)=>{           
            const booking = req.body;
            const query = {
                appoimentDate : booking.appoimentDate,
                treatment : booking.treatment,
                email: booking.email
            }            
            const alredybook = await bookingColletion.find(query).toArray();
            if(alredybook.length){
                const message = `You are alredy booking ${booking.appoimentDate}`
                return res.send({acknowledged: false, message})
            }

            const result = await bookingColletion.insertOne(booking);        
            //send email for booking
            sendBookingEmail(booking)  

           res.send(result)
        })

        app.get('/bookings/:id',async (req,res)=>{
            const ids = req.params.id;
            const query = {_id: ObjectId(ids)}
            const result = await bookingColletion.findOne(query)
            res.send(result)
        })

        app.post('/users', async (req,res)=>{
            const user = req.body;
            const result = await usersColletion.insertOne(user);
            res.send(result)
        })

        app.get('/users', async (req,res)=>{
            const query = {}
            const users = await usersColletion.find(query).toArray()
            res.send(users)
        })

        app.get('/users/admin/:email', async (req,res)=>{
            const email = req.params.email;
            const query = {email}
            const user = await usersColletion.findOne(query)
            res.send({isAdmin: user?.role === 'admin'})
        })

        app.put('/users/admin/:id',verifyJwt, verifyAdmin, async (req,res)=>{
           
            const ids = req.params.id;
            const filter = {_id: ObjectId(ids)}
            const option = {upsert: true}
            const updateDoc= {
                $set:{
                    role: 'admin'
                }
            }
            const result =await usersColletion.updateOne(filter, updateDoc, option)
            res.send(result)
        })

        app.get('/appoimentspecility',async (req,res)=>{
            const query = {}
            const result = await appoimentOption.find(query).project({name: 1}).toArray();
            res.send(result)
        })

        app.get('/doctors',verifyJwt, verifyAdmin, async (req,res)=>{
            const query ={}
            const result = await doctorColletion.find(query).toArray()
            res.send(result)
        })

        app.delete('/doctors/:id',verifyJwt, verifyAdmin, async (req,res)=>{
            const ids =req.params.id
            const query = {_id: ObjectId(ids)}
            const result = await doctorColletion.deleteOne(query);
            res.send(result)
        })

        app.post('/doctors',verifyJwt,verifyAdmin, async(req,res)=>{
            const query = req.body;
            const result = await doctorColletion.insertOne(query);
            res.send(result)
        })

        //appoiment update price
        // app.get('/addprice',async (req,res)=>{
        //     const query ={}
        //     const option ={ upsert: true}
        //     const updateDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const update = await appoimentOption.updateMany(query, updateDoc, option)
        //     res.send(update)
        // })

       // payment api
        app.post('/create-payment-intent',async (req,res)=>{
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentInten = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                  ]
            });
            res.send({
                clientSecret: paymentInten.client_secret,
              });
        })

       
        app.post('/payments', async(req,res)=>{
            const payment = req.body;
            const result = await paymentColletion.insertOne(payment);
            const id = payment.bookingId;
            const filter = {_id: ObjectId(id)}
            const updateDoc ={
                $set :{
                    paid: true,
                    transId: payment.transId,
                }
            }
            const updateResult = await bookingColletion.updateOne(filter, updateDoc)
            res.send(result)
        })

       

         app.get('/jwt', verifyJwt, async(req,res)=>{
            const email = req.query.email;         
            const query = {email: email}
            const user = await usersColletion.findOne(query)
            if(user){
                const token = jwt.sign({email}, process.env.ACESS_TOKEN, {expiresIn: '12h'})
                return res.send({acessToken: token})
            }
             res.status(403).send({acessToken: ' '})

        })
        
    }
    finally{

    }
}
run().catch(console.log())



app.get('/', (req,res)=>{
    res.send('server is running..!')
})

app.listen(port,()=>{
    console.log(`server running ${port}`);
})

//doc-protal
//2z5kFHxVWJTDwF88

//Support Email:
//1. tarique@programming-hero.com
//2. ishtiaque@programming-hero.com
