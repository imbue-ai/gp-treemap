/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Cocoa/Cocoa.h>


/* Error that signals recoverable errors at the application level, e.g. failure to open a file. It
 * is not intended for critical errors, e.g. assertion failures due to bugs.
 */
@interface ApplicationError : NSError {
}

// Overrides designated initialiser
- (instancetype) initWithDomain:(NSString *)domain
                           code:(NSInteger)code
                       userInfo:(NSDictionary *)userInfo NS_UNAVAILABLE;

- (instancetype) initWithLocalizedDescription:(NSString *)descr;
- (instancetype) initWithCode:(int)code localizedDescription:(NSString *)descr;
- (instancetype) initWithCode:(int)code userInfo:(NSDictionary *)userInfo NS_DESIGNATED_INITIALIZER;

+ (instancetype) errorWithLocalizedDescription:(NSString *)descr;
+ (instancetype) errorWithCode:(int)code localizedDescription:(NSString *)descr;
+ (instancetype) errorWithCode:(int)code userInfo:(NSDictionary *)userInfo;

@end
