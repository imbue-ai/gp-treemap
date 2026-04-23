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


/* Although its name and API suggest a more general window management functionality, all that this
 * class does is managing the titles of windows so that each is unique. Also, it takes care of the
 * placement of new windows.
 */
@interface WindowManager : NSObject {
  // The keys are window (base) titles, the values the number of windows created with that title.
  NSMutableDictionary  *titleLookup;
  
  // The position of the next window that is added
  NSPoint  nextWindowPosition;
}

- (void) addWindow:(NSWindow *)window usingTitle:(NSString *)title;

@end
