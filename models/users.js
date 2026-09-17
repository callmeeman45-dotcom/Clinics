const mongoose=require("mongoose");
const passportLocalMongoose=require("passport-local-mongoose").default;
const Schema=mongoose.Schema;
const UserSchema=new Schema({
    email:{
        type:String,
        required:true,
    },
    role:{
        type:"String",
        required:true
    }
});


UserSchema.plugin(passportLocalMongoose);
const Usermodel=mongoose.model("User",UserSchema);
module.exports=Usermodel;